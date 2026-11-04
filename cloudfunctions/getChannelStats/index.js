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

// 云函数跑在 UTC，按东八区切天，否则凌晨 0-8 点的新增会算到前一天
function dayKey(ms) {
  const d = new Date(ms + 8 * 3600 * 1000)
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate())
}

const PAGE = 100
const MAX_PAGES = 10

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

    // 用户列表：按绑定时间倒序翻页取，最多 1000 条；超过置 usersTruncated，
    // 否则推广用户多时列表只显示随机的 100 条，搜索也搜不到没取到的人
    let allUsers = []
    let usersTruncated = false
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await db
          .collection('channel_users')
          .where(where)
          .orderBy('boundAt', 'desc')
          .skip(page * PAGE)
          .limit(PAGE)
          .get()
        const rows = r.data || []
        allUsers.push.apply(allUsers, rows)
        if (rows.length < PAGE) break
        if (page === MAX_PAGES - 1) usersTruncated = true
      }
    } catch (e) {
      // 兜底：个别数据缺 boundAt 导致数据库排序失败时，退回无排序的简单查询
      allUsers = []
      const r = await db.collection('channel_users').where({ channelId }).limit(100).get()
      allUsers = r.data || []
    }

    // 佣金：按月份过滤（原先没有月份条件，"本月佣金"实际是累计值），
    // 并翻页取全量——单次 get 上限 100 条，原来的 limit(80) 会截断导致少算。
    const payConds = [{ channelId }]
    if (range) payConds.push({ createdAt: _.gte(range.start).and(_.lt(range.end)) })
    const payWhere = payConds.length === 1 ? payConds[0] : _.and(payConds)
    const pays = []
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
    let refundedAmount = 0
    pays.forEach((p) => {
      // 已退款冲销的单不计入佣金，但单独累计，结算页要提示差异
      if (p.status === 'failed') {
        refundedAmount += p.commissionAmount || 0
        return
      }
      if (p.userId) paidSet[p.userId] = true
      const n = p.commissionAmount || 0
      totalCommission += n
      // 已被管理员结算过的行不再算「待结」，否则结算完这个数永远不降
      if (p.status === 'pending' && !p.settledAt) pendingCommission += n
    })

    // 当月新增：单独翻页统计（上面的列表已翻到 1000 上限，不能拿来当总数），同时按天聚合，供日历展示
    const dailyNew = {}
    let monthNewUsers = 0
    if (range) {
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          const r = await db
            .collection('channel_users')
            .where(where)
            .skip(page * PAGE)
            .limit(PAGE)
            .get()
          const rows = r.data || []
          rows.forEach((u) => {
            const t = toMs(u.boundAt)
            if (!t) return
            monthNewUsers++
            const k = dayKey(t)
            dailyNew[k] = (dailyNew[k] || 0) + 1
          })
          if (rows.length < PAGE) break
        }
      } catch (e) {
        console.warn('getChannelStats dailyNew', e && e.message)
      }
    }

    // 不采集头像昵称，列表只用 openid 后 8 位作为识别号
    if (wechatQ) {
      const q = wechatQ.toLowerCase()
      allUsers = allUsers.filter((u) => {
        const id = String(u._openid || '')
        return [u.wxMark, u.wechatId, id.slice(-8)]
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

    // 选了月份就只看当月新增，否则才是总数
    let userCount = monthNewUsers
    if (!range) {
      try {
        const c = await db.collection('channel_users').where({ channelId }).count()
        userCount = (c && c.total) || 0
      } catch (e) {
        userCount = 0
      }
    }

    // 结算状态：只有指定月份才有意义
    let settlement = null
    if (range) {
      try {
        const s = await db.collection('channel_settlements').doc(channelId + '_' + month).get()
        if (s && s.data) {
          settlement = {
            status: s.data.status === 'settled' ? 'settled' : 'unsettled',
            settledAt: toMs(s.data.settledAt),
            commissionAmount: s.data.commissionAmount || 0,
            refundedAmount: s.data.refundedAmount || 0,
          }
        }
      } catch (e) {
        // 集合还没建或该月未结算，按未结算处理
      }
    }

    const users = allUsers.map((u) => {
      const id = String(u._openid || '')
      // 识别号统一用 openid 后 8 位，和用户自己看到的 wxMark 一致
      const mark = String(u.wxMark || '').trim() || (id ? id.slice(-8).toUpperCase() : '')
      return {
        id: u._id,
        wechatId: mark || '未填写',
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
      refundedAmount,
      dailyNew,
      settlement,
      month: range ? month : '',
      truncated, // 佣金超过 1000 条时可能少算，前端可提示
      usersTruncated, // 用户超过 1000 人时列表只显示最近 1000 人
      users,
    }
  } catch (e) {
    return { ok: false, msg: (e && e.message) || '统计失败' }
  }
}
