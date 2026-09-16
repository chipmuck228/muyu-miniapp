const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const ACTIVATE_TTL_MS = 48 * 60 * 60 * 1000

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
  await ensureAdmins()
  const r = await db.collection('channel_admins').where({ _openid: openid }).limit(1).get()
  return !!(r.data && r.data[0])
}

async function adminCount() {
  await ensureAdmins()
  const r = await db.collection('channel_admins').limit(2).get()
  return (r.data || []).length
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

async function grantPending({ openid, name, contact, applicationId, envVersion }) {
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
    mark: wxMark(openid),
    channelId: a.channelId || '',
    createdAt: toMs(a.createdAt),
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = (event && event.action) || 'check'
  try {
    await ensureApps()
    if (action === 'check') {
      const n = await adminCount()
      return { ok: true, isAdmin: n === 0 ? false : await isAdmin(OPENID), needsBootstrap: n === 0 }
    }

    if (action === 'bootstrap') {
      const n = await adminCount()
      if (n === 0) {
        await db.collection('channel_admins').add({ data: { _openid: OPENID, createdAt: db.serverDate() } })
        return { ok: true, isAdmin: true, bootstrapped: true }
      }
      if (await isAdmin(OPENID)) return { ok: true, isAdmin: true, bootstrapped: false }
      return { ok: false, msg: '无管理权限' }
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

    if (action === 'wipe') {
      const WIPE = [
        'channels',
        'channel_applications',
        'channel_operators',
        'channel_bind_codes',
        'channel_users',
        'channel_commissions',
        'channel_owners',
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
