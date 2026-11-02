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
    // 搜索不再下推到数据库：昵称存在 users 集合里，需要先关联出来才能一起匹配
    const where = conds.length === 1 ? conds[0] : _.and(conds)

    let usersR
    try {
      usersR = await db.collection('channel_users').where(where).limit(100).get()
    } catch (e) {
      usersR = await db.collection('channel_users').where({ channelId }).limit(100).get()
    }

    // 佣金：按月份过滤（原先没有月份条件，"本月佣金"实际是累计值），
    // 并翻页取全量——单次 get 上限 100 条，原来的 limit(80) 会截断导致少算。
    const payConds = [{ channelId }]
    if (range) payConds.push({ createdAt: _.gte(range.start).and(_.lt(range.end)) })
    const payWhere = payConds.length === 1 ? payConds[0] : _.and(payConds)
    const pays = []
    const PAGE = 100
    const MAX_PAGES = 10
    let truncated = false
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await db
        .collection('channel_commissions')
        .where(payWhere)
        .orderBy('createdAt', 'desc')
        .skip(page * PAGE)
        .limit(PAGE)
        .get()
      const rows = r.data || []
      pays.push.apply(pays, rows)
      if (rows.length < PAGE) break
      if (page === MAX_PAGES - 1) truncated = true
    }
    const paidSet = {}
    let totalCommission = 0
    let pendingCommission = 0
    pays.forEach((p) => {
      if (p.status === 'failed') return // 已退款冲销的不计入
      if (p.userId) paidSet[p.userId] = true
      const n = p.commissionAmount || 0
      totalCommission += n
      if (p.status === 'pending') pendingCommission += n
    })

    let allUsers = usersR.data || []

    // 关联 users：昵称和头像是用户本人授权填写的，channel_users 里没有。
    // 微信不支持凭 openid 反查他人头像昵称，所以只能读我们自己存的这份。
    const openids = allUsers.map((u) => String(u._openid || '')).filter(Boolean)
    const profileMap = {}
    if (openids.length) {
      try {
        const pr = await db.collection('users').where({ _id: _.in(openids) }).limit(100).get()
        ;(pr.data || []).forEach((p) => {
          profileMap[String(p._id)] = {
            nickname: String(p.nickname || '').trim(),
            wechatId: String(p.wechatId || '').trim(),
            avatarFileID: String(p.avatarFileID || '').trim(),
          }
        })
      } catch (e) {
        console.warn('getChannelStats profiles', e && e.message)
      }
    }

    // cloud:// 在 <image> 里不能直接用，批量换成 https 临时链接
    const fileIDs = Object.keys(profileMap)
      .map((k) => profileMap[k].avatarFileID)
      .filter((f) => f.indexOf('cloud://') === 0)
    const urlMap = {}
    for (let i = 0; i < fileIDs.length; i += 50) {
      try {
        const tr = await cloud.getTempFileURL({ fileList: fileIDs.slice(i, i + 50) })
        ;(tr.fileList || []).forEach((f) => {
          if (f.status === 0 && f.tempFileURL) urlMap[f.fileID] = f.tempFileURL
        })
      } catch (e) {
        console.warn('getChannelStats tempURL', e && e.message)
      }
    }

    if (wechatQ) {
      const q = wechatQ.toLowerCase()
      allUsers = allUsers.filter((u) => {
        const id = String(u._openid || '')
        const p = profileMap[id] || {}
        // 默认占位昵称 '静心的人' 不参与匹配，否则搜「静心」会命中所有人
        const nick = p.nickname && p.nickname !== '静心的人' ? p.nickname : ''
        return [u.wxMark, u.wechatId, p.wechatId, nick, id.slice(-8)]
          .some((v) => String(v || '').toLowerCase().indexOf(q) >= 0)
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

    const users = allUsers.slice(0, 100).map((u) => {
      const id = String(u._openid || '')
      const p = profileMap[id] || {}
      // channel_users.wechatId 是绑定时的快照，用户后来在资料页填的微信号存在 users 里，
      // 后者才是最新值，优先用它。'静心的人' 是默认占位昵称，不当作用户填过的昵称。
      const rawNick = String(p.nickname || '').trim()
      return {
        id: u._id,
        wechatId: p.wechatId || u.wechatId || u.wxMark || (id ? id.slice(-8).toUpperCase() : '未填写'),
        nickname: rawNick && rawNick !== '静心的人' ? rawNick : '',
        avatarUrl: urlMap[p.avatarFileID] || '',
        boundAt: toMs(u.boundAt),
        paid: !!paidSet[id],
      }
    })

    return {
      ok: true,
      name: channel.name || '渠道',
      status: channel.status || '',
      userCount,
      paidCount: Object.keys(paidSet).length,
      totalCommission,
      pendingCommission,
      truncated, // 佣金超过 1000 条时可能少算，前端可提示
      users,
    }
  } catch (e) {
    return { ok: false, msg: (e && e.message) || '统计失败' }
  }
}
