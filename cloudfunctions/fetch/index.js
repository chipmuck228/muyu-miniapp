const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const DEFAULT_SETTINGS = { soundOn: true, vibrateOn: true, autoMode: false }

function normalizeUser(u) {
  if (!u) return u
  return {
    ...u,
    settings: u.settings && typeof u.settings === 'object'
      ? { ...DEFAULT_SETTINGS, ...u.settings }
      : { ...DEFAULT_SETTINGS },
  }
}

async function ensureUser(openid) {
  try {
    const r = await db.collection('users').doc(openid).get()
    return normalizeUser(r.data)
  } catch (e) {
    const doc = {
      _id: openid,
      _openid: openid,
      nickname: '禅心行者',
      totalMerit: 0,
      createdAt: new Date(),
      lastHitDate: null,
      settings: { ...DEFAULT_SETTINGS },
    }
    await db.collection('users').add({ data: doc })
    return doc
  }
}

async function fetchWishes(openid) {
  const r = await db
    .collection('wishes')
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
  return r.data
}

// 统计连续敲击天数：今日或昨日为起点向前回溯
function calcStreak(map, today) {
  let streak = 0
  let cursor = new Date(today + 'T00:00:00')
  if (!map[today]) {
    cursor.setDate(cursor.getDate() - 1)
  }
  while (true) {
    const key = cursor.toISOString().slice(0, 10)
    if (map[key] && map[key] > 0) {
      streak += 1
      cursor.setDate(cursor.getDate() - 1)
    } else {
      break
    }
  }
  return streak
}

function dayMap(rows) {
  const map = {}
  rows.forEach((r) => {
    if (r && r.date) map[r.date] = r.count || 0
  })
  return map
}

async function readDaily(openid, startDate) {
  const r = await db
    .collection('daily_hits')
    .where({ _openid: openid, date: _.gte(startDate) })
    .limit(1000)
    .get()
  return r.data
}

// 聚合查询：home / wishes / detail / profile
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = (event && event.action) || ''
  const clientDate = (event && event.date) || ''
  const today = /^\d{4}-\d{2}-\d{2}$/.test(clientDate)
    ? clientDate
    : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)

  try {
    if (action === 'home') {
      const user = await ensureUser(OPENID)
      const wishes = await fetchWishes(OPENID)
      const start = new Date(today + 'T00:00:00')
      start.setDate(start.getDate() - 59)
      const dailyRows = await readDaily(OPENID, start.toISOString().slice(0, 10))
      const map = dayMap(dailyRows)
      const activeWish = wishes.find((w) => w.status === 'ongoing') || null
      const completedWish = wishes.find((w) => w.status === 'completed') || null
      return {
        ok: true,
        user,
        activeWish,
        completedWish,
        streak: calcStreak(map, today),
        todayCount: map[today] || 0,
      }
    }

    if (action === 'wishes') {
      const user = await ensureUser(OPENID)
      const wishes = await fetchWishes(OPENID)
      return { ok: true, user, wishes }
    }

    if (action === 'detail') {
      const wishId = event && event.wishId
      if (!wishId) return { ok: false, msg: '缺少心愿 id' }
      const r = await db.collection('wishes').doc(wishId).get().catch(() => null)
      const wish = r && r.data && r.data._openid === OPENID ? r.data : null
      if (!wish) return { ok: false, msg: '心愿不存在' }
      return { ok: true, wish }
    }

    if (action === 'profile') {
      const user = await ensureUser(OPENID)
      const wishes = await fetchWishes(OPENID)
      const start = new Date(today + 'T00:00:00')
      start.setDate(start.getDate() - 60)
      const dailyRows = await readDaily(OPENID, start.toISOString().slice(0, 10))
      const map = dayMap(dailyRows)
      return {
        ok: true,
        user,
        wishes,
        map,
        streak: calcStreak(map, today),
        todayCount: map[today] || 0,
      }
    }

    return { ok: false, msg: '未知操作' }
  } catch (e) {
    return { ok: false, msg: (e && e.message) || '查询失败' }
  }
}
