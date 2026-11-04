const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 手机号只做结算联系用，格式校验到此为止（不查运营商归属）
const PHONE_RE = /^1[3-9]\d{9}$/

function normalizeCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
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

function appType(a) {
  return a && a.type === 'unbind' ? 'unbind' : 'bind'
}

function ownsChannel(ch, openid) {
  if (!ch || !openid) return false
  return ch.boundOpenid === openid || ch.authorizedOpenid === openid
}

function wxMark(openid) {
  const s = String(openid || '')
  if (s.length <= 8) return s.toUpperCase()
  return s.slice(-8).toUpperCase()
}

function expired(ch) {
  const t = toMs(ch && ch.activateExpireAt)
  return !!(t && Date.now() > t)
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
  } catch (e) {
    // ignore
  }
}

async function ensureApps() {
  await ensureCollection('channel_applications')
}

async function ensureOwners() {
  await ensureCollection('channel_owners')
}

async function activeByOpenid(openid) {
  const a = await db.collection('channels').where({ boundOpenid: openid }).limit(5).get()
  const owned = (a.data || []).find((c) => c.status === 'active')
  if (owned) return owned
  const b = await db.collection('channels').where({ authorizedOpenid: openid }).limit(5).get()
  return (b.data || []).find((c) => c.status === 'active') || null
}

async function authorizedPending(openid) {
  const r = await db.collection('channels').where({ authorizedOpenid: openid }).limit(5).get()
  return (r.data || []).find((c) => c.status === 'pending') || null
}

async function listMyApps(openid) {
  const a = await db.collection('channel_applications').where({ openid }).limit(50).get()
  const b = await db.collection('channel_applications').where({ _openid: openid }).limit(50).get()
  const map = {}
  ;(a.data || []).concat(b.data || []).forEach((row) => {
    if (row && row._id) map[row._id] = row
  })
  return Object.keys(map)
    .map((id) => Object.assign({ _id: id }, map[id]))
    .sort((x, y) => toMs(y.createdAt) - toMs(x.createdAt))
}

async function pendingOf(openid, type) {
  const rows = await listMyApps(openid)
  return rows.find((a) => a.status === 'pending' && appType(a) === type) || null
}

async function saveChannelName(openid, name) {
  try {
    await db.collection('users').doc(openid).update({
      data: { channelName: name || '', wxMark: wxMark(openid) },
    })
  } catch (e) {
    // 未登录过则跳过
  }
}

async function addOwnerIfMissing(ch, openid) {
  if (!ch || !openid) return
  await ensureOwners()
  const had = await db.collection('channel_owners').where({ channelId: ch._id, openid }).limit(5).get()
  const active = (had.data || []).find((o) => o.status === 'active')
  if (active) return
  if (ch.status !== 'active' || !ownsChannel(ch, openid)) return
  await db.collection('channel_owners').add({
    data: {
      channelId: ch._id,
      openid,
      wechatId: ch.wechatId || '',
      name: ch.name || '',
      status: 'active',
      boundAt: ch.activatedAt || ch.createdAt || db.serverDate(),
      unboundAt: null,
    },
  })
}

async function listTenures(openid, myApps) {
  await ensureOwners()
  let owners = []
  try {
    const r = await db.collection('channel_owners').where({ openid }).limit(50).get()
    owners = r.data || []
  } catch (e) {
    owners = []
  }

  const ownedCh = await db.collection('channels').where({ boundOpenid: openid }).limit(10).get()
  const authCh = await db.collection('channels').where({ authorizedOpenid: openid }).limit(10).get()
  const channels = (ownedCh.data || []).concat(authCh.data || [])
  for (let i = 0; i < channels.length; i++) {
    await addOwnerIfMissing(channels[i], openid)
  }
  if (channels.length) {
    const r2 = await db.collection('channel_owners').where({ openid }).limit(50).get()
    owners = r2.data || []
  }

  const seen = {}
  const tenures = []
  const sorted = owners.slice().sort((a, b) => toMs(b.boundAt) - toMs(a.boundAt))
  for (let i = 0; i < sorted.length; i++) {
    const o = sorted[i]
    const channelId = o.channelId
    if (!channelId || seen[channelId + ':' + o.status + ':' + toMs(o.boundAt)]) continue
    seen[channelId + ':' + o.status + ':' + toMs(o.boundAt)] = true
    let name = o.name || ''
    let chStatus = o.status
    try {
      const doc = await db.collection('channels').doc(channelId).get()
      const ch = doc && doc.data
      if (ch) {
        name = ch.name || name
        if (ch.status === 'active' && ownsChannel(ch, openid)) chStatus = 'active'
        else if (o.status === 'unbound' || ch.status === 'unbound') chStatus = 'unbound'
      }
    } catch (e) {
      // keep
    }
    tenures.push({
      channelId,
      name: name || '渠道',
      status: chStatus === 'active' ? 'active' : 'unbound',
      wechatId: o.wechatId || '',
      boundAt: toMs(o.boundAt),
      unboundAt: toMs(o.unboundAt),
    })
  }

  // 兜底：channel_owners 是"当前绑定关系"的补充表，历史迁移或多次申请-解绑后
  // 可能缺记录，导致早期渠道从「我的推广」历史里消失、历史佣金再也点不到。
  // 申请记录里 grantPending 一定会写 channelId，用它把漏掉的渠道补回来（按已解绑处理）。
  try {
    const apps = myApps || (await listMyApps(openid))
    const known = {}
    tenures.forEach((t) => {
      known[t.channelId] = true
    })
    const extra = apps.filter((a) => a.status === 'authorized' && a.channelId && !known[a.channelId])
    for (let i = 0; i < extra.length; i++) {
      const a = extra[i]
      if (known[a.channelId]) continue
      known[a.channelId] = true
      let name = a.name || '渠道'
      try {
        const d = await db.collection('channels').doc(a.channelId).get()
        if (d && d.data) name = d.data.name || name
      } catch (e) {
        // keep
      }
      tenures.push({
        channelId: a.channelId,
        name,
        status: 'unbound',
        wechatId: '',
        boundAt: toMs(a.handledAt || a.createdAt),
        unboundAt: 0,
      })
    }
  } catch (e) {
    // 兜底失败不影响原有列表
  }
  return tenures
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = (event && event.action) || 'status'
  try {
    await ensureApps()

    if (action === 'status') {
      const owned = await activeByOpenid(OPENID)
      if (owned) {
        return { ok: true, phase: 'active', channelId: owned._id, name: owned.name || '渠道' }
      }
      const pendingCh = await authorizedPending(OPENID)
      if (pendingCh) {
        return {
          ok: true,
          phase: 'authorized',
          channelId: pendingCh._id,
          name: pendingCh.name || '渠道',
          activateCode: pendingCh.activateCode || '',
          fileID: pendingCh.activateQrFileID || '',
          expireAt: toMs(pendingCh.activateExpireAt),
          expired: expired(pendingCh),
        }
      }
      const ap = await pendingOf(OPENID, 'bind')
      if (ap) {
        return { ok: true, phase: 'applied', name: ap.name || '', contact: ap.contact || '' }
      }
      return { ok: true, phase: 'none' }
    }

    if (action === 'hub') {
      const owned = await activeByOpenid(OPENID)
      const pendingCh = await authorizedPending(OPENID)
      const myApps = await listMyApps(OPENID)
      const tenures = await listTenures(OPENID, myApps)
      // 授权过的申请记了 channelId；查一下对应渠道还在不在绑定中，
      // 申请记录才能显示「绑定中 / 已解绑」这种最终状态（解绑后渠道会被置 unbound）
      const chStatus = {}
      const chIds = Array.from(new Set(myApps.map((a) => a.channelId).filter(Boolean)))
      for (let i = 0; i < chIds.length; i++) {
        const d = await db.collection('channels').doc(chIds[i]).get().catch(() => null)
        if (d && d.data) chStatus[chIds[i]] = d.data.status || ''
      }
      const applications = myApps.map((a) => ({
        _id: a._id,
        type: appType(a),
        status: a.status || '',
        name: a.name || '',
        phone: a.phone || '',
        wechatId: a.wechatId || '',
        // 授权过的申请带 channelId，前端据此查看该渠道的历史佣金（解绑后也要能看）
        channelId: a.channelId || '',
        createdAt: toMs(a.createdAt),
        handledAt: toMs(a.handledAt),
        channelStatus: a.channelId ? chStatus[a.channelId] || '' : '',
      }))
      const pendingBind = applications.some((a) => a.type === 'bind' && a.status === 'pending')
      const pendingUnbind = applications.some((a) => a.type === 'unbind' && a.status === 'pending')
      const actExpired = !!(pendingCh && expired(pendingCh))
      // 手机号取当前有效的那份：已激活渠道 > 待激活渠道 > 待审申请
      const bindApp = (await pendingOf(OPENID, 'bind')) || {}
      const phone = (owned && owned.phone) || (pendingCh && pendingCh.phone) || bindApp.phone || ''
      return {
        ok: true,
        isChannel: !!owned,
        channelId: owned ? owned._id : '',
        name: owned ? owned.name || '渠道' : '',
        phone,
        canApplyBind: !owned && !pendingBind && !pendingCh,
        canApplyUnbind: !!owned && !pendingUnbind,
        pendingBind,
        pendingUnbind,
        needActivate: !owned && !!pendingCh,
        activateName: pendingCh ? pendingCh.name || '渠道' : '',
        activateCode: pendingCh ? pendingCh.activateCode || '' : '',
        activateFileID: pendingCh ? pendingCh.activateQrFileID || '' : '',
        activateExpireAt: pendingCh ? toMs(pendingCh.activateExpireAt) : 0,
        activateExpired: actExpired,
        tenures,
        applications,
      }
    }

    if (action === 'updatePhone') {
      // 用户按 openid 自助改号：只能改自己名下的申请/渠道，改不了别人的。
      // 手机号只用于结算联系，不是身份凭证，所以不需要验证码或人工审核。
      const phone = String((event && event.phone) || '').trim()
      if (!PHONE_RE.test(phone)) return { ok: false, msg: '请填写正确的 11 位手机号' }
      let touched = 0

      const ap = await pendingOf(OPENID, 'bind')
      if (ap) {
        await db.collection('channel_applications').doc(ap._id).update({
          data: { phone, updatedAt: db.serverDate() },
        })
        touched++
      }

      const pendingCh = await authorizedPending(OPENID)
      if (pendingCh) {
        await db.collection('channels').doc(pendingCh._id).update({ data: { phone } })
        touched++
      }

      const owned = await activeByOpenid(OPENID)
      if (owned) {
        await db.collection('channels').doc(owned._id).update({ data: { phone } })
        touched++
      }

      if (!touched) return { ok: false, msg: '没有可修改的申请记录' }
      return { ok: true, phone }
    }

    if (action === 'apply') {
      const name = String((event && event.name) || '').trim().slice(0, 40)
      const contact = String((event && event.contact) || '').trim().slice(0, 40)
      const phone = String((event && event.phone) || '').trim()
      if (!name) return { ok: false, msg: '请填写名称' }
      if (!PHONE_RE.test(phone)) return { ok: false, msg: '请填写正确的 11 位手机号' }
      if (await activeByOpenid(OPENID)) return { ok: false, msg: '当前微信已绑定渠道' }
      if (await authorizedPending(OPENID)) return { ok: false, msg: '已获授权，请激活' }
      await saveChannelName(OPENID, name)
      const old = await pendingOf(OPENID, 'bind')
      if (old) {
        await db.collection('channel_applications').doc(old._id).update({
          data: {
            type: 'bind',
            name,
            contact,
            phone,
            openid: OPENID,
            updatedAt: db.serverDate(),
          },
        })
        return { ok: true, phase: 'applied' }
      }
      await db.collection('channel_applications').add({
        data: {
          type: 'bind',
          openid: OPENID,
          name,
          contact,
          phone,
          status: 'pending',
          channelId: '',
          createdAt: db.serverDate(),
        },
      })
      return { ok: true, phase: 'applied' }
    }

    if (action === 'applyUnbind') {
      const owned = await activeByOpenid(OPENID)
      if (!owned) return { ok: false, msg: '当前没有绑定中的渠道' }
      if (await pendingOf(OPENID, 'unbind')) return { ok: false, msg: '已有待处理的解绑申请' }
      await db.collection('channel_applications').add({
        data: {
          type: 'unbind',
          openid: OPENID,
          phone: owned.phone || '',
          name: owned.name || '',
          contact: owned.contact || '',
          status: 'pending',
          channelId: owned._id,
          createdAt: db.serverDate(),
        },
      })
      return { ok: true, phase: 'unbind_applied' }
    }

    const activateCode = normalizeCode(event && event.activateCode)
    if (!/^[A-Z0-9]{6}$/.test(activateCode)) {
      return { ok: false, success: false, msg: '激活码无效' }
    }
    const r = await db.collection('channels').where({ activateCode }).limit(1).get()
    const ch = r.data && r.data[0]
    if (!ch) return { ok: false, success: false, msg: '激活码不存在' }
    if (ch.status === 'disabled') return { ok: false, success: false, msg: '该渠道已停用' }
    if (!ch.authorizedOpenid) {
      return { ok: false, success: false, msg: '此激活码尚未指定微信' }
    }
    if (ch.authorizedOpenid !== OPENID) {
      return { ok: false, success: false, msg: '此激活码未授权给当前微信' }
    }
    if (expired(ch) && ch.status === 'pending') {
      return { ok: false, success: false, msg: '激活码已过期' }
    }

    if (action === 'preview') {
      if (ch.status !== 'pending' && !ownsChannel(ch, OPENID)) {
        return { ok: false, success: false, msg: '激活码已使用' }
      }
      return {
        ok: true,
        name: ch.name || '渠道',
        activateCode,
        fileID: ch.activateQrFileID || '',
        pending: ch.status === 'pending',
        expireAt: toMs(ch.activateExpireAt),
        expired: expired(ch),
      }
    }

    const owned = await activeByOpenid(OPENID)
    if (owned && owned._id !== ch._id) {
      return { ok: false, success: false, msg: '当前微信已激活过渠道' }
    }
    if (ch.status === 'active' && ownsChannel(ch, OPENID)) {
      return { ok: true, success: true, channelId: ch._id, already: true }
    }
    if (ch.status !== 'pending') return { ok: false, success: false, msg: '激活码已使用' }
    if (expired(ch)) return { ok: false, success: false, msg: '激活码已过期' }

    await db.collection('channels').doc(ch._id).update({
      data: {
        status: 'active',
        boundOpenid: OPENID,
        activatedAt: db.serverDate(),
      },
    })
    await addOwnerIfMissing(Object.assign({}, ch, { status: 'active', boundOpenid: OPENID }), OPENID)
    return { ok: true, success: true, channelId: ch._id }
  } catch (e) {
    return { ok: false, success: false, msg: (e && e.message) || '操作失败' }
  }
}
