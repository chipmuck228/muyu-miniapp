const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const title = String((event && (event.title || event.name)) || '虚拟内容').slice(0, 40)
  const amount = parseInt(event && event.amount, 10)
  if (!amount || amount < 1) return { ok: false, success: false, msg: '金额无效' }

  const orderId = 'o' + Date.now() + Math.random().toString(36).slice(2, 8)
  try {
    const bind = await db.collection('channel_users').where({ _openid: OPENID }).limit(1).get()
    const rel = bind.data && bind.data[0]
    if (!rel) {
      return {
        ok: true,
        success: true,
        orderId,
        title,
        orderAmount: amount,
        profitSharing: false,
        commissionAmount: 0,
      }
    }
    const ch = await db.collection('channels').doc(rel.channelId).get().catch(() => null)
    const channel = ch && ch.data
    if (!channel || channel.status !== 'active') {
      return {
        ok: true,
        success: true,
        orderId,
        title,
        orderAmount: amount,
        profitSharing: false,
        commissionAmount: 0,
      }
    }
    let rate = Number(channel.commissionRate)
    if (!(rate > 0)) rate = 0
    if (rate > 0.3) rate = 0.3
    const commissionAmount = Math.floor(amount * rate)
    const canShare = !!(channel.subMerchantId && commissionAmount > 0)
    await db.collection('channel_commissions').add({
      data: {
        channelId: rel.channelId,
        userId: OPENID,
        orderId,
        orderAmount: amount,
        commissionAmount,
        status: 'pending',
        createdAt: db.serverDate(),
        settledAt: null,
        title,
      },
    })
    return {
      ok: true,
      success: true,
      orderId,
      title,
      orderAmount: amount,
      profitSharing: canShare,
      commissionAmount,
      channelId: rel.channelId,
      msg: canShare ? '已记佣金，待支付成功后分账' : '已记佣金（未配置子商户号，暂不分账）',
    }
  } catch (e) {
    return { ok: false, success: false, msg: (e && e.message) || '下单失败' }
  }
}
