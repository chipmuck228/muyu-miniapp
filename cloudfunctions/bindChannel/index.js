const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function ensureUsers() {
  try {
    await db.createCollection('channel_users')
  } catch (e) {
    // ignore
  }
}

function normalizeScene(raw) {
  let scene = String(raw || '').trim()
  try {
    scene = decodeURIComponent(scene)
  } catch (e) {
    // keep
  }
  return scene
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const scene = normalizeScene(event && event.scene)
  if (!scene || scene.indexOf('ch_') !== 0) {
    return { ok: true, bound: false, reason: 'bad_scene' }
  }
  const key = scene.slice(3).trim()
  if (!key) return { ok: true, bound: false, reason: 'bad_scene' }
  try {
    await ensureUsers()
    const had = await db.collection('channel_users').where({ _openid: OPENID }).limit(1).get()
    if (had.data && had.data.length) {
      return { ok: true, bound: false, reason: 'already_bound', channelId: had.data[0].channelId }
    }

    let channelId = ''
    let ch = null
    const byKey = await db.collection('channels').where({ promoKey: key }).limit(1).get()
    if (byKey.data && byKey.data[0]) {
      ch = byKey.data[0]
      channelId = ch._id
    } else {
      const doc = await db.collection('channels').doc(key).get().catch(() => null)
      if (doc && doc.data) {
        ch = doc.data
        channelId = key
      }
    }
    if (!channelId || !ch || ch.status !== 'active') {
      return { ok: true, bound: false, reason: 'channel_invalid' }
    }

    let wechatId = ''
    let wxMark = ''
    try {
      const u = await db.collection('users').doc(OPENID).get()
      wechatId = (u && u.data && u.data.wechatId) || ''
      wxMark = (u && u.data && u.data.wxMark) || ''
    } catch (e) {
      // 未填写则空
    }
    if (!wxMark) {
      const s = String(OPENID || '')
      wxMark = s.length <= 8 ? s.toUpperCase() : s.slice(-8).toUpperCase()
    }
    await db.collection('channel_users').add({
      data: {
        _openid: OPENID,
        channelId,
        wechatId,
        wxMark,
        boundAt: db.serverDate(),
        source: scene,
      },
    })
    return { ok: true, bound: true, channelId }
  } catch (e) {
    return { ok: false, bound: false, msg: (e && e.message) || '绑定失败' }
  }
}
