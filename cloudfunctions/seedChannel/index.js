const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const name = String((event && event.name) || '测试渠道').trim().slice(0, 40)
  const contact = String((event && event.contact) || '').trim().slice(0, 40)
  const activateCode = String((event && event.activateCode) || 'AB3K7P')
    .trim()
    .toUpperCase()
  let rate = Number(event && event.commissionRate)
  if (!(rate > 0)) rate = 0.3
  if (rate > 0.3) rate = 0.3
  if (!/^[A-Z0-9]{6}$/.test(activateCode)) {
    return { ok: false, msg: 'activateCode 需为 6 位大写字母或数字' }
  }
  try {
    try {
      await db.createCollection('channels')
    } catch (e) {
      // 已存在则忽略
    }
    const had = await db.collection('channels').where({ activateCode }).limit(1).get()
    if (had.data && had.data[0]) {
      return {
        ok: true,
        existed: true,
        channelId: had.data[0]._id,
        activateCode,
        status: had.data[0].status,
        msg: '该激活码已存在，未重复写入',
      }
    }
    const r = await db.collection('channels').add({
      data: {
        name,
        contact,
        activateCode,
        commissionRate: rate,
        subMerchantId: String((event && event.subMerchantId) || ''),
        status: 'pending',
        _openid: '',
        activatedAt: null,
        createdAt: db.serverDate(),
      },
    })
    return { ok: true, existed: false, channelId: r._id, activateCode, status: 'pending' }
  } catch (e) {
    return { ok: false, msg: (e && e.message) || '写入失败' }
  }
}
