const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function randCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  try {
    const r = await db.collection('channel_operators').where({ _openid: OPENID }).limit(1).get()
    const op = r.data && r.data[0]
    if (!op) return { ok: false, success: false, msg: '无渠道权限' }
    const code = randCode()
    await db.collection('channel_bind_codes').add({
      data: {
        code,
        channelId: op.channelId,
        createdBy: OPENID,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        used: false,
        usedBy: null,
        usedAt: null,
      },
    })
    return { ok: true, success: true, bindCode: code }
  } catch (e) {
    return { ok: false, success: false, msg: (e && e.message) || '生成失败' }
  }
}
