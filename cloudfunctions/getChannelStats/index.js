const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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

function ownsChannel(ch, openid) {
  if (!ch || !openid) return false
  return ch.boundOpenid === openid || ch.authorizedOpenid === openid
}

async function canView(channelId, openid) {
  const chDoc = await db.collection('channels').doc(channelId).get().catch(() => null)
  const channel = (chDoc && chDoc.data) || null
  if (!channel) return null
  if (ownsChannel(channel, openid)) return channel
  try {
    const t = await db.collection('channel_owners').where({ channelId, openid }).limit(1).get()
    if (t.data && t.data[0]) return channel
  } catch (e) {
    // ignore
  }
  return null
}

function monthRange(month) {
  const s = String(month || '').trim()
  const m = /^(\d{4})-(\d{2})$/.exec(s)
  if (!m) return null
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  if (!y || mo < 1 || mo > 12) return null
  return { start: new Date(y, mo - 1, 1), end: new Date(y, mo, 1) }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const channelId = String((event && event.channelId) || '').trim()
  const wechatQ = String((event && event.wechatId) || '').trim()
  const month = String((event && event.month) || '').trim()
  if (!channelId) return { ok: false, msg: '缺少渠道 id' }
  try {
    const channel = await canView(channelId, OPENID)
    if (!channel) return { ok: false, msg: '无渠道权限' }

    const conds = [{ channelId }]
    const range = monthRange(month)
    if (range) conds.push({ boundAt: _.gte(range.start).and(_.lt(range.end)) })
    if (wechatQ) {
      conds.push({
        wechatId: db.RegExp({
          regexp: wechatQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          options: 'i',
        }),
      })
    }
    const where = conds.length === 1 ? conds[0] : _.and(conds)

    let usersR
    try {
      usersR = await db.collection('channel_users').where(where).limit(100).get()
    } catch (e) {
      usersR = await db.collection('channel_users').where({ channelId }).limit(100).get()
    }

    const payR = await db
      .collection('channel_commissions')
      .where({ channelId })
      .orderBy('createdAt', 'desc')
      .limit(80)
      .get()
    const pays = payR.data || []
    const paidSet = {}
    let totalCommission = 0
    let pendingCommission = 0
    pays.forEach((p) => {
      if (p.status === 'failed') return
      if (p.userId) paidSet[p.userId] = true
      const n = p.commissionAmount || 0
      totalCommission += n
      if (p.status === 'pending') pendingCommission += n
    })

    let allUsers = usersR.data || []
    if (wechatQ) {
      const q = wechatQ.toLowerCase()
      allUsers = allUsers.filter((u) => {
        const mark = String(u.wxMark || u.wechatId || '').toLowerCase()
        const tail = String(u._openid || '').slice(-8).toLowerCase()
        return mark.indexOf(q) >= 0 || tail.indexOf(q) >= 0
      })
    }
    if (range) {
      allUsers = allUsers.filter((u) => {
        const t = toMs(u.boundAt)
        return t >= range.start.getTime() && t < range.end.getTime()
      })
    }
    allUsers.sort((a, b) => toMs(b.boundAt) - toMs(a.boundAt))

    let userCount = allUsers.length
    try {
      const c = await db.collection('channel_users').where({ channelId }).count()
      userCount = (c && c.total) || userCount
    } catch (e) {
      // keep filtered length as fallback only if count fails
    }

    const users = allUsers.slice(0, 100).map((u) => ({
      id: u._id,
      wechatId: u.wxMark || u.wechatId || (u._openid ? String(u._openid).slice(-8).toUpperCase() : '未填写'),
      boundAt: toMs(u.boundAt),
      paid: !!paidSet[u._openid],
    }))

    return {
      ok: true,
      name: channel.name || '渠道',
      status: channel.status || '',
      userCount,
      paidCount: Object.keys(paidSet).length,
      totalCommission,
      pendingCommission,
      users,
    }
  } catch (e) {
    return { ok: false, msg: (e && e.message) || '统计失败' }
  }
}
