const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DEFAULT_SETTINGS = { soundOn: true, vibrateOn: true, autoMode: false, ambience: 'off' }

function serverDateStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
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

// 敲击：users.totalMerit / daily_hits 当天计数 / 当前心愿进度 三处原子累加
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const date = (event && event.date) || serverDateStr()
  const raw = parseInt(event && event.n, 10)
  const n = Math.max(1, Math.min(999, isNaN(raw) ? 1 : raw))
  const wishId = event && event.wishId

  const users = db.collection('users')
  const daily = db.collection('daily_hits')
  try {
    // 1. 用户总功德
    let user = null
    try {
      const r = await users.doc(OPENID).get()
      user = r.data
    } catch (e) {
      user = null
    }
    if (!user) {
      const doc = {
        _id: OPENID,
        _openid: OPENID,
        nickname: '静心的人',
        wxMark: String(OPENID).slice(-8).toUpperCase(),
        totalMerit: 0,
        createdAt: new Date(),
        lastHitDate: null,
        settings: { ...DEFAULT_SETTINGS },
      }
      await users.add({ data: doc })
      user = doc
    }
    const totalMerit = (user.totalMerit || 0) + n
    await users.doc(OPENID).update({ data: { totalMerit, lastHitDate: date } })

    // 2. 每日敲击记录（固定 _id = openid_date，防重复）
    const dailyId = OPENID + '_' + date
    let todayCount = n
    try {
      const r = await daily.doc(dailyId).get()
      todayCount = (r.data.count || 0) + n
      await daily.doc(dailyId).update({ data: { count: todayCount } })
    } catch (e) {
      try {
        await daily.add({ data: { _id: dailyId, _openid: OPENID, date, count: n } })
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
        if (w && w._openid === OPENID && w.status === 'ongoing') {
          const current = (w.current || 0) + n
          const patch = { current, hitLog: mergeHitLog(w.hitLog, date, n) }
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

    return { ok: true, totalMerit, todayCount, wish }
  } catch (e) {
    return { ok: false, msg: (e && e.message) || '敲击失败' }
  }
}
