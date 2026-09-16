const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DEFAULT_SETTINGS = { soundOn: true, vibrateOn: true, autoMode: false, ambience: 'off' }

// 更新用户设置（音效/震动/自动敲击开关）
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const patch = Object.assign({}, (event && event.settings) || {})
  const allowed = { off: 1, rain: 1, noise: 1, bowl: 1 }
  if (patch.ambience && !allowed[patch.ambience]) delete patch.ambience
  try {
    let settings = { ...DEFAULT_SETTINGS }
    try {
      const res = await db.collection('users').doc(OPENID).get()
      const cur = (res.data && res.data.settings) || {}
      settings = { ...DEFAULT_SETTINGS, ...cur, ...patch }
    } catch (e) {
      // 用户不存在则先创建
      await db.collection('users').add({
        data: {
          _id: OPENID,
          _openid: OPENID,
          nickname: '静心的人',
          wxMark: String(OPENID).slice(-8).toUpperCase(),
          totalMerit: 0,
          createdAt: new Date(),
          lastHitDate: null,
          settings,
        },
      })
      return { ok: true, settings }
    }
    await db.collection('users').doc(OPENID).update({ data: { settings } })
    return { ok: true, settings }
  } catch (e) {
    return { ok: false, msg: (e && e.message) || '保存失败' }
  }
}
