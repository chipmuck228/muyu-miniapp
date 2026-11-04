const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const ACTIVATE_TTL_MS = 48 * 60 * 60 * 1000

// 渠道管理员不再由「第一个打开管理页的人」自动担任——那样任何人抢先进来就能拿到后台。
// 现在只认两种来源：
//   1) 云函数环境变量 CHANNEL_ADMIN_OPENIDS（逗号/分号/空格分隔），部署时写死最省事
//   2) channel_admins 集合（手动加一条，或用 CHANNEL_ADMIN_KEY 口令调 bootstrap 认领）
function configuredAdmins() {
  const raw = String(process.env.CHANNEL_ADMIN_OPENIDS || '')
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => !!s)
}

function isConfiguredAdmin(openid) {
  if (!openid) return false
  return configuredAdmins().indexOf(String(openid)) >= 0
}

function toMs(d) {
  if (!d) return 0
  if (typeof d === 'number') return d
  try {
    const n = new Date(d).getTime()
    return isNaN(n) ? 0 : n
  } catch (e) {
    return 0
  }
}

function wxMark(openid) {
  const s = String(openid || '')
  if (s.length <= 8) return s.toUpperCase()
  return s.slice(-8).toUpperCase()
}

function appType(a) {
  return a && a.type === 'unbind' ? 'unbind' : 'bind'
}

function randCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

function codeEnv(v) {
  return v === 'release' ? 'release' : 'trial'
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (e) {
    // ignore
  }
}

async function ensureAdmins() {
  await ensureCollection('channel_admins')
}

async function ensureApps() {
  await ensureCollection('channel_applications')
}

async function ensureOwners() {
  await ensureCollection('channel_owners')
}

async function isAdmin(openid) {
  if (isConfiguredAdmin(openid)) return true
  await ensureAdmins()
  const r = await db.collection('channel_admins').where({ _openid: openid }).limit(1).get()
  return !!(r.data && r.data[0])
}

async function adminCount() {
  await ensureAdmins()
  const r = await db.collection('channel_admins').limit(2).get()
  return configuredAdmins().length + (r.data || []).length
}

async function getApplication(id) {
  const doc = await db.collection('channel_applications').doc(id).get().catch(() => null)
  return doc && doc.data ? Object.assign({ _id: id }, doc.data) : null
}

async function uniquePromoKey() {
  for (let i = 0; i < 8; i++) {
    const c = (randCode() + randCode()).slice(0, 8)
    const had = await db.collection('channels').where({ promoKey: c }).limit(1).get()
    if (!had.data || !had.data.length) return c
  }
  return ('P' + Date.now().toString(36)).slice(0, 8).toUpperCase()
}

async function uniqueActivateCode() {
  for (let i = 0; i < 8; i++) {
    const c = randCode()
    const had = await db.collection('channels').where({ activateCode: c }).limit(1).get()
    if (!had.data || !had.data.length) return c
  }
  return ''
}

async function makeActivateQr(activateCode, envVersion) {
  const env = codeEnv(envVersion)
  const scene = 'ac_' + activateCode
  const code = await cloud.openapi.wxacode.getUnlimited({
    scene,
    page: 'pages/partner/activate',
    checkPath: false,
    envVersion: env,
    width: 280,
  })
  const buf = code && (code.buffer || code.fileBuffer)
  if (!buf) throw new Error('激活码二维码生成失败')
  const up = await cloud.uploadFile({
    cloudPath: 'channel-activate/' + activateCode + '-' + env + '.png',
    fileContent: Buffer.isBuffer(buf) ? buf : Buffer.from(buf),
  })
  return { fileID: up.fileID, scene }
}

async function openidBusy(openid, exceptChannelId) {
  const ownedR = await db.collection('channels').where({ boundOpenid: openid }).limit(5).get()
  const o = (ownedR.data || []).find((c) => c.status === 'active')
  if (o && o._id !== exceptChannelId) return '该微信已绑定其他渠道'
  const pendingR = await db.collection('channels').where({ authorizedOpenid: openid }).limit(5).get()
  const p = (pendingR.data || []).find((c) => c.status === 'pending' || c.status === 'active')
  if (p && p.status === 'active' && p._id !== exceptChannelId) return '该微信已绑定其他渠道'
  if (p && p.status === 'pending' && p._id !== exceptChannelId) return '该微信已有待激活渠道'
  return ''
}

async function closeOwners(channelId) {
  await ensureOwners()
  const owners = await db.collection('channel_owners').where({ channelId, status: 'active' }).limit(20).get()
  const rows = owners.data || []
  for (let i = 0; i < rows.length; i++) {
    await db.collection('channel_owners').doc(rows[i]._id).update({
      data: { status: 'unbound', unboundAt: db.serverDate() },
    })
  }
}

async function grantPending({ openid, name, contact, phone, applicationId, envVersion }) {
  const busy = await openidBusy(openid, '')
  if (busy) return { ok: false, msg: busy }
  const activateCode = await uniqueActivateCode()
  if (!activateCode) return { ok: false, msg: '激活码生成失败' }
  const promoKey = await uniquePromoKey()
  const qr = await makeActivateQr(activateCode, envVersion)
  const expireAt = new Date(Date.now() + ACTIVATE_TTL_MS)
  const add = await db.collection('channels').add({
    data: {
      name: name || '渠道',
      contact: contact || '',
      phone: phone || '',
      activateCode,
      promoKey,
      activateQrFileID: qr.fileID,
      activateExpireAt: expireAt,
      commissionRate: 0.3,
      subMerchantId: '',
      status: 'pending',
      authorizedOpenid: openid,
      boundOpenid: '',
      activatedAt: null,
      createdAt: db.serverDate(),
    },
  })
  await db.collection('channel_applications').doc(applicationId).update({
    data: {
      status: 'authorized',
      channelId: add._id,
      handledAt: db.serverDate(),
    },
  })
  return {
    ok: true,
    channelId: add._id,
    activateCode,
    fileID: qr.fileID,
    name: name || '渠道',
    expireAt: expireAt.getTime(),
  }
}

async function unbindChannel(channelId) {
  const doc = await db.collection('channels').doc(channelId).get().catch(() => null)
  if (!doc || !doc.data) return { ok: false, msg: '渠道不存在' }
  await db.collection('channels').doc(channelId).update({
    data: {
      status: 'unbound',
      authorizedOpenid: '',
      boundOpenid: '',
      activatedAt: null,
    },
  })
  await closeOwners(channelId)
  const apps = await db.collection('channel_applications').limit(80).get()
  const related = (apps.data || []).filter((a) => a.channelId === channelId && a.status === 'pending' && appType(a) === 'unbind')
  for (let i = 0; i < related.length; i++) {
    await db.collection('channel_applications').doc(related[i]._id).update({
      data: { status: 'authorized', handledAt: db.serverDate() },
    })
  }
  return { ok: true, channelId }
}

function mapApp(a) {
  const openid = a.openid || a._openid || ''
  return {
    _id: a._id,
    type: appType(a),
    name: a.name || '',
    contact: a.contact || '',
    phone: a.phone || '',
    mark: wxMark(openid),
    channelId: a.channelId || '',
    createdAt: toMs(a.createdAt),
  }
}

// ===== 佣金结算 =====
// 只标记状态，不触发任何资金划转：真正打款由管理员线下完成（支付宝按手机号 / 微信商家转账）。
const PAGE = 100
const MAX_PAGES = 10

function monthKeyOf(d) {
  return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1)
}

function currentMonthKey() {
  return monthKeyOf(new Date())
}

function prevMonthKey() {
  const now = new Date()
  return monthKeyOf(new Date(now.getFullYear(), now.getMonth() - 1, 1))
}

function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || '').trim())
  if (!m) return null
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  if (mo < 1 || mo > 12) return null
  return { start: new Date(y, mo - 1, 1), end: new Date(y, mo, 1) }
}

// 汇总某渠道某自然月：新增推广用户、付费人数、订单额、佣金、已退款佣金
async function collectMonth(channelId, month) {
  const range = monthRange(month)
  const out = { userCount: 0, paidCount: 0, orderAmount: 0, commissionAmount: 0, refundedAmount: 0 }
  if (!range) return out

  try {
    let n = 0
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await db
        .collection('channel_users')
        .where({ channelId, boundAt: _.gte(range.start).and(_.lt(range.end)) })
        .skip(page * PAGE)
        .limit(PAGE)
        .get()
      const rows = r.data || []
      n += rows.length
      if (rows.length < PAGE) break
    }
    out.userCount = n
  } catch (e) {
    console.warn('collectMonth users', e && e.message)
  }

  try {
    const paid = {}
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await db
        .collection('channel_commissions')
        .where({ channelId, createdAt: _.gte(range.start).and(_.lt(range.end)) })
        .skip(page * PAGE)
        .limit(PAGE)
        .get()
      const rows = r.data || []
      rows.forEach((p) => {
        // 已退款的单不计入佣金，但单独记下金额，结算页要提示差异
        if (p.status === 'failed') {
          out.refundedAmount += p.commissionAmount || 0
          return
        }
        if (p.userId) paid[p.userId] = true
        out.orderAmount += p.orderAmount || 0
        out.commissionAmount += p.commissionAmount || 0
      })
      if (rows.length < PAGE) break
    }
    out.paidCount = Object.keys(paid).length
  } catch (e) {
    console.warn('collectMonth commissions', e && e.message)
  }

  return out
}

async function readSettlement(channelId, month) {
  try {
    const d = await db.collection('channel_settlements').doc(channelId + '_' + month).get()
    return (d && d.data) || null
  } catch (e) {
    return null
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = (event && event.action) || 'check'
  try {
    await ensureApps()
    if (action === 'check') {
      // needsBootstrap 恒为 false：自动认领已移除，管理权只来自环境变量白名单或 channel_admins。
      // 保留这个字段是为了兼容还没更新的旧客户端。
      return {
        ok: true,
        isAdmin: await isAdmin(OPENID),
        needsBootstrap: false,
        configured: configuredAdmins().length > 0,
        // 返回调用者自己的 openid，方便把它填进 CHANNEL_ADMIN_OPENIDS。
        // 只回自己的，不涉及他人。
        openid: OPENID,
      }
    }

    if (action === 'bootstrap') {
      // 自助认领必须带口令，且云函数要配了 CHANNEL_ADMIN_KEY。
      // 没配就直接拒绝——不能让第一个打开管理页的人白白拿到后台。
      const key = String(process.env.CHANNEL_ADMIN_KEY || '')
      if (!key) return { ok: false, msg: '未配置 CHANNEL_ADMIN_KEY，不能自助认领管理员' }
      if (String((event && event.key) || '') !== key) return { ok: false, msg: '口令不正确' }
      if (await isAdmin(OPENID)) return { ok: true, isAdmin: true, bootstrapped: false }
      await db.collection('channel_admins').add({ data: { _openid: OPENID, createdAt: db.serverDate() } })
      return { ok: true, isAdmin: true, bootstrapped: true }
    }

    if (!(await isAdmin(OPENID))) return { ok: false, msg: '无管理权限' }

    if (action === 'list') {
      const r = await db.collection('channels').limit(80).get()
      const list = (r.data || [])
        .slice()
        .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
        .map((c) => ({
          _id: c._id,
          name: c.name,
          contact: c.contact || '',
          mark: wxMark(c.boundOpenid || c.authorizedOpenid),
          status: c.status,
          commissionRate: c.commissionRate,
          bound: !!(c.boundOpenid && c.status === 'active'),
          authorized: !!c.authorizedOpenid,
          expireAt: toMs(c.activateExpireAt),
        }))
      return { ok: true, list }
    }

    if (action === 'apps') {
      const r = await db.collection('channel_applications').limit(80).get()
      const pending = (r.data || [])
        .filter((a) => a.status === 'pending')
        .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
      const bindApps = pending.filter((a) => appType(a) === 'bind').map(mapApp)
      const unbindApps = pending.filter((a) => appType(a) === 'unbind').map(mapApp)
      return { ok: true, apps: bindApps, bindApps, unbindApps }
    }

    if (action === 'authorize') {
      const applicationId = String((event && event.applicationId) || '').trim()
      if (!applicationId) return { ok: false, msg: '缺少申请' }
      const ap = await getApplication(applicationId)
      const applicant = ap && (ap.openid || ap._openid)
      if (!ap || ap.status !== 'pending' || appType(ap) !== 'bind' || !applicant) {
        return { ok: false, msg: '申请无效' }
      }
      return grantPending({
        openid: applicant,
        name: ap.name || '',
        contact: ap.contact || '',
        phone: ap.phone || '',
        applicationId,
        envVersion: event && event.envVersion,
      })
    }

    if (action === 'reject') {
      const applicationId = String((event && event.applicationId) || '').trim()
      if (!applicationId) return { ok: false, msg: '缺少申请' }
      const ap = await getApplication(applicationId)
      if (!ap || ap.status !== 'pending') return { ok: false, msg: '申请无效' }
      await db.collection('channel_applications').doc(applicationId).update({
        data: { status: 'rejected', handledAt: db.serverDate() },
      })
      return { ok: true }
    }

    if (action === 'qr') {
      const channelId = String((event && event.channelId) || '').trim()
      if (!channelId) return { ok: false, msg: '缺少渠道 id' }
      const doc = await db.collection('channels').doc(channelId).get().catch(() => null)
      const ch = doc && doc.data
      if (!ch || !ch.activateCode) return { ok: false, msg: '渠道不存在' }
      if (!ch.authorizedOpenid) return { ok: false, msg: '尚未指定微信' }
      if (ch.activateQrFileID && ch.status === 'pending') {
        return {
          ok: true,
          channelId,
          activateCode: ch.activateCode,
          fileID: ch.activateQrFileID,
          expireAt: toMs(ch.activateExpireAt),
        }
      }
      const qr = await makeActivateQr(ch.activateCode, event && event.envVersion)
      const expireAt = ch.activateExpireAt || new Date(Date.now() + ACTIVATE_TTL_MS)
      await db.collection('channels').doc(channelId).update({
        data: { activateQrFileID: qr.fileID, activateExpireAt: expireAt },
      })
      return {
        ok: true,
        channelId,
        activateCode: ch.activateCode,
        fileID: qr.fileID,
        expireAt: toMs(expireAt),
      }
    }

    if (action === 'refreshActivate') {
      const channelId = String((event && event.channelId) || '').trim()
      if (!channelId) return { ok: false, msg: '缺少渠道 id' }
      const doc = await db.collection('channels').doc(channelId).get().catch(() => null)
      const ch = doc && doc.data
      if (!ch || ch.status !== 'pending' || !ch.authorizedOpenid) return { ok: false, msg: '仅待激活渠道可重发' }
      const activateCode = await uniqueActivateCode()
      if (!activateCode) return { ok: false, msg: '激活码生成失败' }
      const qr = await makeActivateQr(activateCode, event && event.envVersion)
      const expireAt = new Date(Date.now() + ACTIVATE_TTL_MS)
      await db.collection('channels').doc(channelId).update({
        data: {
          activateCode,
          activateQrFileID: qr.fileID,
          activateExpireAt: expireAt,
        },
      })
      return {
        ok: true,
        channelId,
        activateCode,
        fileID: qr.fileID,
        expireAt: expireAt.getTime(),
        name: ch.name || '渠道',
      }
    }

    if (action === 'unbind') {
      const channelId = String((event && event.channelId) || '').trim()
      if (!channelId) return { ok: false, msg: '缺少渠道 id' }
      return unbindChannel(channelId)
    }

    if (action === 'approveUnbind') {
      const applicationId = String((event && event.applicationId) || '').trim()
      if (!applicationId) return { ok: false, msg: '缺少申请' }
      const ap = await getApplication(applicationId)
      if (!ap || ap.status !== 'pending' || appType(ap) !== 'unbind') {
        return { ok: false, msg: '申请无效' }
      }
      const channelId = String(ap.channelId || '').trim()
      if (!channelId) return { ok: false, msg: '申请未关联渠道' }
      const r = await unbindChannel(channelId)
      if (!r.ok) return r
      await db.collection('channel_applications').doc(applicationId).update({
        data: { status: 'authorized', channelId, handledAt: db.serverDate() },
      })
      return r
    }

    if (action === 'settleBoard') {
      const month = String((event && event.month) || '').trim() || prevMonthKey()
      if (!monthRange(month)) return { ok: false, msg: '月份格式应为 YYYY-MM' }
      const r = await db.collection('channels').limit(80).get()
      const all = r.data || []
      // 不能只按"当前活跃"过滤：解绑会把 status/boundOpenid/authorizedOpenid 全部清空，
      // 但该渠道历史月份的佣金仍要能出现在看板里结算。因此对每个渠道先算聚合，
      // 已不活跃且该月没有任何推广数据的渠道才跳过。
      const list = []
      for (let i = 0; i < all.length; i++) {
        const c = all[i]
        const agg = await collectMonth(c._id, month)
        const isActive = c.status === 'active' || c.boundOpenid || c.authorizedOpenid
        if (!isActive && !agg.userCount && !agg.commissionAmount) continue
        const settlement = await readSettlement(c._id, month)
        const settled = !!(settlement && settlement.status === 'settled')
        // 已结算的显示当时快照，避免退款冲销后数字和已打款的金额对不上
        list.push({
          channelId: c._id,
          name: c.name || '渠道',
          phone: c.phone || '',
          receiverOpenid: c.boundOpenid || c.authorizedOpenid || '',
          rate: Number(c.commissionRate) || 0,
          userCount: settled ? settlement.userCount || 0 : agg.userCount,
          paidCount: settled ? settlement.paidCount || 0 : agg.paidCount,
          orderAmount: settled ? settlement.orderAmount || 0 : agg.orderAmount,
          commissionAmount: settled ? settlement.commissionAmount || 0 : agg.commissionAmount,
          refundedAmount: settled ? settlement.refundedAmount || 0 : agg.refundedAmount,
          status: settled ? 'settled' : 'unsettled',
          settledAt: settlement ? toMs(settlement.settledAt) : 0,
        })
      }
      list.sort((a, b) => b.commissionAmount - a.commissionAmount)
      return { ok: true, month, list }
    }

    if (action === 'settle') {
      // 只写状态，不转账。同一渠道同一月只能结算一次（_id 幂等）。
      const channelId = String((event && event.channelId) || '').trim()
      const month = String((event && event.month) || '').trim()
      if (!channelId) return { ok: false, msg: '缺少渠道 id' }
      if (!monthRange(month)) return { ok: false, msg: '月份格式应为 YYYY-MM' }
      if (month >= currentMonthKey()) return { ok: false, msg: '只能结算已经结束的月份' }

      const doc = await db.collection('channels').doc(channelId).get().catch(() => null)
      const ch = doc && doc.data
      if (!ch) return { ok: false, msg: '渠道不存在' }

      const id = channelId + '_' + month
      const existing = await readSettlement(channelId, month)
      if (existing && existing.status === 'settled') {
        return { ok: true, already: true, settlement: existing }
      }

      const agg = await collectMonth(channelId, month)
      const patch = {
        channelId,
        channelName: ch.name || '渠道',
        month,
        phone: ch.phone || '',
        receiverOpenid: ch.boundOpenid || ch.authorizedOpenid || '',
        rate: Number(ch.commissionRate) || 0,
        userCount: agg.userCount,
        paidCount: agg.paidCount,
        orderAmount: agg.orderAmount,
        commissionAmount: agg.commissionAmount,
        refundedAmount: agg.refundedAmount,
        status: 'settled',
        settledAt: db.serverDate(),
        settledBy: OPENID,
        updatedAt: db.serverDate(),
      }

      await ensureCollection('channel_settlements')
      if (existing) {
        await db.collection('channel_settlements').doc(id).update({ data: patch })
      } else {
        await db.collection('channel_settlements').add({
          data: Object.assign({ _id: id, createdAt: db.serverDate() }, patch),
        })
      }

      // 回写该月佣金行，便于逐笔审计（失败不阻断结算）
      const range = monthRange(month)
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          const r = await db
            .collection('channel_commissions')
            .where({ channelId, createdAt: _.gte(range.start).and(_.lt(range.end)) })
            .skip(page * PAGE)
            .limit(PAGE)
            .get()
          const rows = r.data || []
          for (let i = 0; i < rows.length; i++) {
            await db
              .collection('channel_commissions')
              .doc(rows[i]._id)
              .update({ data: { settlementId: id, settledAt: db.serverDate() } })
              .catch(() => {})
          }
          if (rows.length < PAGE) break
        }
      } catch (e) {
        console.warn('settle mark rows', e && e.message)
      }

      return {
        ok: true,
        already: false,
        settlement: Object.assign({}, patch, {
          _id: id,
          settledAt: Date.now(),
          createdAt: existing ? existing.createdAt : Date.now(),
        }),
      }
    }

    if (action === 'wipe') {
      const WIPE = [
        'channels',
        'channel_applications',
        'channel_operators',
        'channel_bind_codes',
        'channel_users',
        'channel_commissions',
        'channel_owners',
        'channel_settlements',
      ]
      const results = []
      for (let i = 0; i < WIPE.length; i++) {
        const name = WIPE[i]
        let removed = 0
        let error = ''
        try {
          for (;;) {
            const r = await db.collection(name).limit(20).get()
            const rows = r.data || []
            if (!rows.length) break
            for (let j = 0; j < rows.length; j++) {
              await db.collection(name).doc(rows[j]._id).remove()
              removed++
            }
          }
        } catch (e) {
          error = (e && e.message) || String(e)
        }
        results.push({ name, removed, error: error || undefined })
      }
      return { ok: true, results }
    }

    return { ok: false, msg: '未知操作' }
  } catch (e) {
    return { ok: false, msg: (e && e.message) || '操作失败' }
  }
}
