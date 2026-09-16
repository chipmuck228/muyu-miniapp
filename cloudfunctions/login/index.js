const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DEFAULT_SETTINGS = { soundOn: true, vibrateOn: true, autoMode: false, ambience: 'off' }

function normalizeUser(u) {
  if (!u) return u
  return {
    ...u,
    settings: u.settings && typeof u.settings === 'object'
      ? { ...DEFAULT_SETTINGS, ...u.settings }
      : { ...DEFAULT_SETTINGS },
  }
}

// 首次进入小程序时调用：静默获取 openid，users 集合不存在则创建
exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) {
    return { ok: false, msg: '未获取到 openid' }
  }
  try {
    const res = await db.collection('users').where({ _id: OPENID }).limit(1).get()
    let user = res.data[0]
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
      await db.collection('users').add({ data: doc })
      user = doc
    } else if (!user.wxMark) {
      const wxMark = String(OPENID).slice(-8).toUpperCase()
      await db.collection('users').doc(OPENID).update({ data: { wxMark } })
      user.wxMark = wxMark
    }
    return { ok: true, openid: OPENID, user: normalizeUser(user) }
  } catch (e) {
    return { ok: false, msg: (e && e.message) || '登录失败' }
  }
}
