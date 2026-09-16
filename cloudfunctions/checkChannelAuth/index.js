const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  try {
    const a = await db.collection('channels').where({ boundOpenid: OPENID }).limit(5).get()
    let ch = (a.data || []).find((c) => c.status === 'active')
    if (!ch) {
      const b = await db.collection('channels').where({ authorizedOpenid: OPENID }).limit(5).get()
      ch = (b.data || []).find((c) => c.status === 'active')
    }
    if (ch) return { ok: true, isChannel: true, channelId: ch._id, role: 'owner' }
    return { ok: true, isChannel: false }
  } catch (e) {
    return { ok: true, isChannel: false }
  }
}
