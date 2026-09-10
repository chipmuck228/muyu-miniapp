const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function serverDateStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

function validDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

async function ownWish(wishId, openid) {
  const r = await db.collection('wishes').doc(wishId).get()
  const w = r.data
  if (!w || w._openid !== openid) return null
  return w
}

// 心愿写操作：create / update / fulfill
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = (event && event.action) || ''
  try {
    if (action === 'create') {
      const name = ((event && event.name) || '').trim()
      const goal = parseInt(event && event.goal, 10)
      if (!name) return { ok: false, msg: '请填写心愿名称' }
      if (!goal || goal < 1) return { ok: false, msg: '功德目标需为不小于 1 的整数' }
      const data = {
        _openid: OPENID,
        name: name.slice(0, 20),
        goal,
        current: 0,
        deadline: event && validDate(event.deadline) ? event.deadline : null,
        status: 'ongoing',
        createdAt: new Date(),
        hitLog: [],
      }
      const r = await db.collection('wishes').add({ data })
      return { ok: true, wishId: r._id }
    }

    if (action === 'update') {
      const wishId = event && event.wishId
      if (!wishId) return { ok: false, msg: '缺少心愿 id' }
      const w = await ownWish(wishId, OPENID)
      if (!w) return { ok: false, msg: '心愿不存在' }
      const name = ((event && event.name) || '').trim()
      const goal = parseInt(event && event.goal, 10)
      if (!name) return { ok: false, msg: '请填写心愿名称' }
      if (!goal || goal < 1) return { ok: false, msg: '功德目标需为不小于 1 的整数' }
      const data = {
        name: name.slice(0, 20),
        goal,
        deadline: event && validDate(event.deadline) ? event.deadline : null,
      }
      await db.collection('wishes').doc(wishId).update({ data })
      return { ok: true, wishId }
    }

    if (action === 'fulfill') {
      const wishId = event && event.wishId
      if (!wishId) return { ok: false, msg: '缺少心愿 id' }
      const w = await ownWish(wishId, OPENID)
      if (!w) return { ok: false, msg: '心愿不存在' }
      if (w.status === 'fulfilled') return { ok: true, wish: w }
      const date = (event && validDate(event.date) && event.date) || serverDateStr()
      const patch = { status: 'fulfilled', fulfilledDate: date, fulfilledAt: new Date() }
      await db.collection('wishes').doc(wishId).update({ data: patch })
      return { ok: true, wish: Object.assign({}, w, patch) }
    }

    if (action === 'remove') {
      const wishId = event && event.wishId
      if (!wishId) return { ok: false, msg: '缺少心愿 id' }
      const w = await ownWish(wishId, OPENID)
      if (!w) return { ok: false, msg: '心愿不存在' }
      await db.collection('wishes').doc(wishId).remove()
      return { ok: true }
    }

    return { ok: false, msg: '未知操作' }
  } catch (e) {
    return { ok: false, msg: (e && e.message) || '操作失败' }
  }
}
