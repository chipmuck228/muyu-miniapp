const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const DEFAULT_SETTINGS = { soundOn: true, vibrateOn: true, autoMode: false, ambience: 'off', theme: 'dawn' }

// 一炷香暂时关闭：不再接受点香；结算 / 掐灭照常，好收掉残留的香。客户端 INCENSE_ON 同步
const INCENSE_ON = false
// 一炷香：可选时长（分钟）与折算（每分钟计多少专注）。客户端 utils/constants.ts 同步
const INCENSE_MINUTES = { 15: 1, 30: 1, 45: 1 }
const INCENSE_RATE = 10
// 客户端计时与云端时钟的容差
const INCENSE_SLACK_MS = 5000

function serverDateStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

function clampInt(v, lo, hi) {
  const n = parseInt(v, 10)
  if (isNaN(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

// 心愿敲击日志（按日期合并，升序，最多保留 366 天）
function mergeHitLog(hitLog, date, n) {
  const arr = Array.isArray(hitLog) ? hitLog.slice() : []
  const idx = arr.findIndex((x) => x && x.date === date)
  if (idx >= 0) {
    arr[idx] = { date, count: (arr[idx].count || 0) + n }
  } else {
    arr.push({ date, count: n })
  }
  arr.sort((a, b) => (a.date < b.date ? -1 : 1))
  while (arr.length > 366) arr.shift()
  return arr
}

// 按来源累加：hand 亲手 / auto 自动 / incense 燃香。旧客户端不带来源，只计总数
function mergeBySource(prev, by) {
  const out = Object.assign({ hand: 0, auto: 0, incense: 0 }, prev || {})
  Object.keys(by).forEach((k) => {
    out[k] = (out[k] || 0) + by[k]
  })
  return out
}

async function ensureUser(users, openid) {
  try {
    const r = await users.doc(openid).get()
    if (r.data) return r.data
  } catch (e) {
    // 新用户
  }
  const doc = {
    _id: openid,
    _openid: openid,
    nickname: '静心的人',
    wxMark: String(openid).slice(-8).toUpperCase(),
    totalMerit: 0,
    premium: false,
    createdAt: new Date(),
    lastHitDate: null,
    settings: { ...DEFAULT_SETTINGS },
  }
  await users.add({ data: doc })
  return doc
}

// 记一笔专注：users.totalMerit / daily_hits 当天计数 / 当前心愿进度 三处累加
async function credit(openid, user, date, wishId, n, by, wishExtra) {
  const users = db.collection('users')
  const daily = db.collection('daily_hits')

  // 1. 用户总功德
  const totalMerit = (user.totalMerit || 0) + n
  await users.doc(openid).update({ data: { totalMerit, lastHitDate: date } })

  // 2. 每日敲击记录（固定 _id = openid_date，防重复）
  const dailyId = openid + '_' + date
  let todayCount = n
  try {
    const r = await daily.doc(dailyId).get()
    todayCount = (r.data.count || 0) + n
    await daily.doc(dailyId).update({ data: { count: todayCount } })
  } catch (e) {
    try {
      await daily.add({ data: { _id: dailyId, _openid: openid, date, count: n } })
      todayCount = n
    } catch (e2) {
      const r2 = await daily.doc(dailyId).get().catch(() => null)
      if (r2 && r2.data) {
        todayCount = (r2.data.count || 0) + n
        await daily.doc(dailyId).update({ data: { count: todayCount } })
      }
    }
  }

  // 3. 心愿进度
  let wish = null
  if (wishId) {
    try {
      const wr = await db.collection('wishes').doc(wishId).get()
      const w = wr.data
      if (w && w._openid === openid && w.status === 'ongoing') {
        const current = (w.current || 0) + n
        const patch = { current, hitLog: mergeHitLog(w.hitLog, date, n) }
        if (by) patch.bySource = mergeBySource(w.bySource, by)
        if (wishExtra) Object.assign(patch, wishExtra(w))
        if (current >= (w.goal || 0)) {
          patch.status = 'completed'
          patch.completedDate = date
          patch.completedAt = new Date()
        }
        await db.collection('wishes').doc(wishId).update({ data: patch })
        wish = Object.assign({}, w, patch)
      }
    } catch (e) {
      wish = null
    }
  }

  return { totalMerit, todayCount, wish }
}

// 记最近这么多批敲击的号，重传的那批认出来就不再记
const RECENT_BATCHES = 30

// 这一批是不是头一回来：在 users 上原子地登记批号，登记成了才记账。
// 客户端超时重传时，上一次其实已经记过，这次登记不上，就只回当前数
async function claimBatch(users, openid, batchId) {
  const r = await users
    .where({ _id: openid, recentBatches: _.nin([batchId]) })
    .update({ data: { recentBatches: _.push({ each: [batchId], slice: -RECENT_BATCHES }) } })
  return !!(r && r.stats && r.stats.updated === 1)
}

// 不记账，只读回当前的总数、当天计数和心愿，给重传的那批回话
async function snapshot(openid, user, date, wishId) {
  let todayCount = 0
  try {
    const r = await db.collection('daily_hits').doc(openid + '_' + date).get()
    todayCount = (r.data && r.data.count) || 0
  } catch (e) {
    todayCount = 0
  }
  let wish = null
  if (wishId) {
    try {
      const wr = await db.collection('wishes').doc(wishId).get()
      if (wr.data && wr.data._openid === openid) wish = wr.data
    } catch (e) {
      wish = null
    }
  }
  return { totalMerit: user.totalMerit || 0, todayCount, wish }
}

function incenseView(inc, now) {
  if (!inc || !inc.startMs || !inc.minutes) return null
  return {
    wishId: inc.wishId || null,
    minutes: inc.minutes,
    startMs: inc.startMs,
    endMs: inc.startMs + inc.minutes * 60000,
    serverNow: now,
  }
}

// 敲击（默认）/ 一炷香：light 点香、settle 燃尽结算、snuff 掐灭
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = (event && event.action) || 'knock'
  const date = (event && event.date) || serverDateStr()
  const users = db.collection('users')

  try {
    const user = await ensureUser(users, OPENID)
    const now = Date.now()

    if (action === 'knock') {
      const raw = event && event.by
      let by = null
      if (raw && typeof raw === 'object') {
        const hand = clampInt(raw.hand, 0, 999)
        const auto = clampInt(raw.auto, 0, 999)
        if (hand + auto > 0) by = { hand, auto }
      }
      const n = by ? by.hand + by.auto : clampInt(event && event.n, 1, 999)
      const wishId = (event && event.wishId) || null
      const batchId = event && typeof event.batchId === 'string' ? event.batchId.slice(0, 40) : ''
      if (batchId && !(await claimBatch(users, OPENID, batchId))) {
        // 已经记过的一批（上次回包丢了）：wish 不带「刚圆满」的含义，客户端只用来刷新数字
        const snap = await snapshot(OPENID, user, date, wishId)
        return Object.assign({ ok: true, duplicate: true }, snap, { wish: null })
      }
      const r = await credit(OPENID, user, date, wishId, n, by, null)
      return Object.assign({ ok: true }, r)
    }

    if (action === 'light') {
      if (!INCENSE_ON) return { ok: false, msg: '一炷香暂未开放' }
      const minutes = parseInt(event && event.minutes, 10)
      if (!INCENSE_MINUTES[minutes]) return { ok: false, msg: '香的时长不对' }
      const cur = incenseView(user.incense, now)
      if (cur) return { ok: true, incense: cur, already: true }
      const inc = { wishId: (event && event.wishId) || null, minutes, startMs: now }
      await users.doc(OPENID).update({ data: { incense: inc } })
      return { ok: true, incense: incenseView(inc, now) }
    }

    if (action === 'snuff') {
      if (user.incense) await users.doc(OPENID).update({ data: { incense: _.remove() } })
      return { ok: true }
    }

    if (action === 'settle') {
      const inc = user.incense
      const view = incenseView(inc, now)
      if (!view) return { ok: true, settled: false }
      if (now + INCENSE_SLACK_MS < view.endMs) return { ok: true, settled: false, incense: view }
      // 只有清掉这炷香的那次请求才记账，重复结算不会多算
      const cleared = await users
        .where({ _id: OPENID, 'incense.startMs': inc.startMs })
        .update({ data: { incense: _.remove() } })
      if (!cleared || !cleared.stats || cleared.stats.updated !== 1) return { ok: true, settled: false }
      const n = inc.minutes * INCENSE_RATE
      const r = await credit(OPENID, user, date, inc.wishId, n, { incense: n }, (w) => ({
        incenseCount: (w.incenseCount || 0) + 1,
      }))
      return Object.assign({ ok: true, settled: true, gained: n, minutes: inc.minutes, wishId: inc.wishId }, r)
    }

    return { ok: false, msg: '未知操作' }
  } catch (e) {
    return { ok: false, msg: (e && e.message) || '敲击失败' }
  }
}
