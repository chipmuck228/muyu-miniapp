const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const BATCH = 100

// 付费档：和 login/fetch/wxpay 里的口径保持一致
const PREMIUM_AMBIENCE = { noise: 1, stream: 1, pine: 1, fire: 1 }
const PREMIUM_THEME = { night: 1, ink: 1, dusk: 1 }

async function drain(name) {
  let removed = 0
  try {
    for (;;) {
      const r = await db.collection(name).limit(BATCH).get()
      const rows = r.data || []
      if (!rows.length) return { name, removed }
      for (let i = 0; i < rows.length; i++) {
        await db.collection(name).doc(rows[i]._id).remove()
        removed++
      }
    }
  } catch (e) {
    const msg = (e && e.message) || String(e)
    if (/not exist|不存在|not found/i.test(msg) && removed === 0) {
      return { name, removed: 0, missing: true }
    }
    return { name, removed, error: msg }
  }
}

// 把所有用户恢复成未付费：premium=false、删掉 premiumAt、把锁定的付费氛围/主题降回免费档。
// 不删 users 文档本身——totalMerit、心愿、设置都在里面，删了总专注会归零，
// 且和 daily_hits / wishes 里的历史记录对不上，看起来像数据坏了。
async function resetUsers() {
  let scanned = 0
  let updated = 0
  let lastId = ''
  for (;;) {
    let r
    try {
      const q = lastId
        ? db.collection('users').where({ _id: _.gt(lastId) }).orderBy('_id', 'asc').limit(BATCH)
        : db.collection('users').orderBy('_id', 'asc').limit(BATCH)
      r = await q.get()
    } catch (e) {
      return { scanned, updated, error: (e && e.message) || String(e) }
    }
    const rows = r.data || []
    if (!rows.length) break

    for (let i = 0; i < rows.length; i++) {
      const u = rows[i]
      scanned++
      lastId = String(u._id)

      const patch = {}
      if (u.premium !== false) patch.premium = false
      if (u.premiumAt !== undefined && u.premiumAt !== null) patch.premiumAt = _.remove()

      // 写整个 settings，不用 'settings.ambience' 点路径：
      // 点路径在 settings 不存在时会让整条 update 失败，连 premium:false 都写不进去。
      const s = Object.assign({}, u.settings || {})
      let changed = false
      if (PREMIUM_AMBIENCE[s.ambience]) {
        s.ambience = 'off'
        changed = true
      }
      if (PREMIUM_THEME[s.theme]) {
        s.theme = 'dawn'
        changed = true
      }
      if (changed) patch.settings = s

      if (!Object.keys(patch).length) continue
      try {
        await db.collection('users').doc(u._id).update({ data: patch })
        updated++
      } catch (e) {
        // 单条失败不中断整体
      }
    }
  }
  return { scanned, updated }
}

exports.main = async (event) => {
  // 这个函数能清空全库付费数据，必须带口令；
  // 口令写在云函数环境变量 RESET_KEY 里，没配就直接拒绝。
  const key = String(process.env.RESET_KEY || '')
  if (!key) return { ok: false, msg: '未配置 RESET_KEY，拒绝执行' }
  if (String((event && event.key) || '') !== key) return { ok: false, msg: '口令不正确' }

  const scope = String((event && event.scope) || 'premium')

  if (scope === 'orders') {
    return {
      ok: true,
      scope,
      premium_orders: await drain('premium_orders'),
      channel_commissions: await drain('channel_commissions'),
    }
  }

  if (scope === 'users') {
    // 危险：连用户档案一起删。totalMerit、昵称、设置都会没，
    // 但 daily_hits / wishes 里的历史记录还在，重新登录后数据看起来会对不上。
    return {
      ok: true,
      scope,
      users: await drain('users'),
      premium_orders: await drain('premium_orders'),
      channel_commissions: await drain('channel_commissions'),
    }
  }

  // 默认：所有用户恢复未付费，订单与佣金清空，用户档案保留
  return {
    ok: true,
    scope: 'premium',
    users: await resetUsers(),
    premium_orders: await drain('premium_orders'),
    channel_commissions: await drain('channel_commissions'),
  }
}
