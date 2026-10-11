const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DEFAULT_SETTINGS = { soundOn: true, vibrateOn: true, autoMode: false, ambience: 'off', theme: 'dawn' }
const FREE_AMBIENCE = { off: 1, rain: 1, bowl: 1 }
const PREMIUM_AMBIENCE = { noise: 1, stream: 1, pine: 1, fire: 1 }
const FREE_THEME = { dawn: 1 }
const PREMIUM_THEME = { night: 1, ink: 1, dusk: 1 }

function dressSettings(raw, premium) {
  const s = Object.assign({}, DEFAULT_SETTINGS, raw || {})
  const ambienceOk = FREE_AMBIENCE[s.ambience] || (premium && PREMIUM_AMBIENCE[s.ambience])
  const themeOk = FREE_THEME[s.theme] || (premium && PREMIUM_THEME[s.theme])
  return {
    soundOn: typeof s.soundOn === 'boolean' ? s.soundOn : true,
    vibrateOn: typeof s.vibrateOn === 'boolean' ? s.vibrateOn : true,
    autoMode: s.autoMode === true,
    ambience: ambienceOk ? s.ambience : 'off',
    theme: themeOk ? s.theme : 'dawn',
  }
}

function normalizeUser(u) {
  if (!u) return u
  const premium = u.premium === true
  return {
    ...u,
    premium,
    settings: dressSettings(u.settings, premium),
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
        premium: false,
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
