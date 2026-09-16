const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const bindCode = String((event && event.bindCode) || '')
    .trim()
    .toUpperCase()
  if (!bindCode) return { ok: false, success: false, msg: '请填写绑定码' }
  try {
    const r = await db
      .collection('channel_bind_codes')
      .where({ code: bindCode, used: false })
      .limit(1)
      .get()
    const row = r.data && r.data[0]
    if (!row) return { ok: false, success: false, msg: '绑定码无效' }
    const exp = row.expiresAt ? new Date(row.expiresAt).getTime() : 0
    if (exp && exp < Date.now()) return { ok: false, success: false, msg: '绑定码已过期' }

    const mine = await db.collection('channel_operators').where({ _openid: OPENID }).limit(1).get()
    const exist = mine.data && mine.data[0]
    if (exist && exist.channelId === row.channelId) {
      return { ok: false, success: false, msg: '已是该渠道操作员' }
    }
    if (exist) return { ok: false, success: false, msg: '当前微信已绑定其他渠道' }

    await db.collection('channel_operators').add({
      data: {
        _openid: OPENID,
        channelId: row.channelId,
        role: 'member',
        boundAt: db.serverDate(),
      },
    })
    await db.collection('channel_bind_codes').doc(row._id).update({
      data: { used: true, usedBy: OPENID, usedAt: db.serverDate() },
    })
    return { ok: true, success: true, channelId: row.channelId }
  } catch (e) {
    return { ok: false, success: false, msg: (e && e.message) || '绑定失败' }
  }
}
