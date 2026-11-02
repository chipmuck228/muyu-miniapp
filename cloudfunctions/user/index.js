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

function wantsPremium(patch, premium) {
  if (!patch || premium) return false
  if (patch.ambience && PREMIUM_AMBIENCE[patch.ambience]) return true
  if (patch.theme && PREMIUM_THEME[patch.theme]) return true
  return false
}

function pickPatch(patch) {
  const next = {}
  if (!patch) return next
  if (typeof patch.soundOn === 'boolean') next.soundOn = patch.soundOn
  if (typeof patch.vibrateOn === 'boolean') next.vibrateOn = patch.vibrateOn
  if (typeof patch.autoMode === 'boolean') next.autoMode = patch.autoMode
  if (FREE_AMBIENCE[patch.ambience] || PREMIUM_AMBIENCE[patch.ambience]) next.ambience = patch.ambience
  if (FREE_THEME[patch.theme] || PREMIUM_THEME[patch.theme]) next.theme = patch.theme
  return next
}

// 用户主动填写的资料。微信不提供「凭 openid 反查他人头像昵称」的能力，
// 所以渠道统计里展示的头像昵称只能来自用户本人授权填写的这份。
// 头像由小程序端 wx.cloud.uploadFile 上传后把 fileID 传进来。
async function saveProfile(OPENID, raw) {
  const p = raw || {}
  const patch = {}
  if (typeof p.nickname === 'string') {
    patch.nickname = p.nickname.trim().slice(0, 20) || '静心的人'
  }
  if (typeof p.wechatId === 'string') {
    patch.wechatId = p.wechatId.trim().slice(0, 40)
  }
  if (typeof p.avatarFileID === 'string') {
    const f = p.avatarFileID.trim().slice(0, 300)
    // 只接受本环境云存储的 fileID，不接受任意外链
    patch.avatarFileID = f.indexOf('cloud://') === 0 ? f : ''
  }
  if (!Object.keys(patch).length) return { ok: false, msg: '没有要保存的资料' }

  const ref = db.collection('users').doc(OPENID)
  let exists = true
  try {
    await ref.get()
  } catch (e) {
    exists = false
  }
  if (!exists) {
    await db.collection('users').add({
      data: {
        _id: OPENID,
        _openid: OPENID,
        nickname: '静心的人',
        wxMark: String(OPENID).slice(-8).toUpperCase(),
        totalMerit: 0,
        premium: false,
        createdAt: new Date(),
        lastHitDate: null,
        settings: { ...DEFAULT_SETTINGS },
        ...patch,
      },
    })
  } else {
    await ref.update({ data: patch })
  }
  const r = await ref.get()
  return { ok: true, user: normalizeProfile(r.data) }
}

function normalizeProfile(u) {
  if (!u) return null
  return {
    nickname: String(u.nickname || '').trim() || '静心的人',
    wechatId: String(u.wechatId || '').trim(),
    avatarFileID: String(u.avatarFileID || '').trim(),
  }
}

// 更新用户设置。premium 不在 settings 里，此函数不能把它写成 true。
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, msg: '未获取到 openid' }
  if (event && event.action === 'unlock') {
    return { ok: false, code: 'use_pay', msg: '请使用支付开启' }
  }
  if (event && event.action === 'profile') {
    try {
      return await saveProfile(OPENID, event.profile)
    } catch (e) {
      return { ok: false, msg: (e && e.message) || '保存资料失败' }
    }
  }
  const patch = (event && event.settings) || {}
  try {
    let user = null
    try {
      const res = await db.collection('users').doc(OPENID).get()
      user = res.data
    } catch (e) {
      user = null
    }
    const premium = !!(user && user.premium === true)
    if (wantsPremium(patch, premium)) {
      return { ok: false, code: 'premium', msg: '一次开启后可用' }
    }
    const next = pickPatch(patch)
    if (!user) {
      const settings = dressSettings(next, false)
      await db.collection('users').add({
        data: {
          _id: OPENID,
          _openid: OPENID,
          nickname: '静心的人',
          wxMark: String(OPENID).slice(-8).toUpperCase(),
          totalMerit: 0,
          premium: false,
          createdAt: new Date(),
          lastHitDate: null,
          settings,
        },
      })
      return { ok: true, settings, premium: false }
    }
    const settings = Object.assign({}, DEFAULT_SETTINGS, user.settings || {}, next)
    await db.collection('users').doc(OPENID).update({ data: { settings } })
    return { ok: true, settings: dressSettings(settings, premium), premium }
  } catch (e) {
    return { ok: false, msg: (e && e.message) || '保存失败' }
  }
}
