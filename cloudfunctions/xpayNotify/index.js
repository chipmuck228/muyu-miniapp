// 云开发「消息推送」绑定本函数，接收 xpay_goods_deliver_notify / xpay_refund_notify。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PRODUCT_TAG = 'premium'
const OK = { ErrCode: 0, ErrMsg: 'success' }

async function ensureOrders() {
  try {
    await db.createCollection('premium_orders')
  } catch (e) {
    // exists
  }
}

async function orderByNo(outTradeNo) {
  if (!outTradeNo) return null
  try {
    const r = await db.collection('premium_orders').where({ outTradeNo }).limit(1).get()
    return (r.data && r.data[0]) || null
  } catch (e) {
    return null
  }
}

async function grantPremium(openid, outTradeNo, extra) {
  if (!openid) return
  await ensureOrders()
  const users = db.collection('users')
  let user = null
  try {
    user = (await users.doc(openid).get()).data
  } catch (e) {
    user = null
  }
  if (!user) {
    await users.add({
      data: {
        _id: openid,
        _openid: openid,
        nickname: '静心的人',
        wxMark: String(openid).slice(-8).toUpperCase(),
        totalMerit: 0,
        premium: true,
        premiumAt: db.serverDate(),
        createdAt: new Date(),
        lastHitDate: null,
        settings: {
          soundOn: true,
          vibrateOn: true,
          autoMode: false,
          ambience: 'off',
          theme: 'dawn',
        },
      },
    })
  } else if (user.premium !== true) {
    await users.doc(openid).update({
      data: { premium: true, premiumAt: db.serverDate() },
    })
  }

  const order = await orderByNo(outTradeNo)
  const patch = Object.assign(
    {
      status: 'delivered',
      deliveredAt: db.serverDate(),
      openid,
    },
    extra || {}
  )
  if (order) {
    if (order.status === 'delivered') return
    await db.collection('premium_orders').doc(order._id).update({ data: patch })
  } else if (outTradeNo) {
    await db.collection('premium_orders').add({
      data: Object.assign(
        {
          outTradeNo,
          _openid: openid,
          createdAt: db.serverDate(),
        },
        patch
      ),
    })
  }
}

async function revokePremium(openid, outTradeNo) {
  if (!openid) return
  try {
    await db.collection('users').doc(openid).update({
      data: { premium: false, premiumRevokedAt: db.serverDate() },
    })
  } catch (e) {
    // user missing
  }
  const order = await orderByNo(outTradeNo)
  if (order) {
    await db.collection('premium_orders').doc(order._id).update({
      data: { status: 'refunded', refundedAt: db.serverDate() },
    })
  }
}

function openidFromAttach(attach, fallback) {
  const s = String(attach || '')
  if (s.indexOf(PRODUCT_TAG + '|') === 0) {
    const id = s.slice(PRODUCT_TAG.length + 1).trim()
    if (id) return id
  }
  return fallback || ''
}

async function onDeliver(event) {
  const outTradeNo = event.OutTradeNo || event.outTradeNo || ''
  const goods = event.GoodsInfo || event.goodsInfo || {}
  const attach = goods.Attach || goods.attach || ''
  const openid = openidFromAttach(attach, event.OpenId || event.openid || '')
  const order = await orderByNo(outTradeNo)
  if (order && order.status === 'delivered') return OK
  if (order && order._openid && openid && order._openid !== openid) {
    console.error('openid mismatch', outTradeNo, order._openid, openid)
    return { ErrCode: -1, ErrMsg: 'openid mismatch' }
  }
  const uid = openid || (order && order._openid) || ''
  if (!uid) {
    console.error('missing openid', event)
    return { ErrCode: -1, ErrMsg: 'missing openid' }
  }
  await grantPremium(uid, outTradeNo, {
    productId: goods.ProductId || goods.productId || '',
    actualPrice: goods.ActualPrice || goods.actualPrice || 0,
    transactionId:
      (event.WeChatPayInfo && (event.WeChatPayInfo.TransactionId || event.WeChatPayInfo.transactionId)) || '',
  })
  return OK
}

async function onRefund(event) {
  const ret = event.RetCode
  if (ret != null && Number(ret) !== 0) return OK
  const outTradeNo = event.MchOrderId || event.OutTradeNo || event.outTradeNo || ''
  const openid = event.OpenId || event.openid || ''
  const order = await orderByNo(outTradeNo)
  const uid = openid || (order && order._openid) || ''
  await revokePremium(uid, outTradeNo)
  return OK
}

exports.main = async (event) => {
  console.log('xpayNotify', JSON.stringify(event || {}).slice(0, 800))
  try {
    const name = (event && (event.Event || event.event)) || ''
    if (name === 'xpay_goods_deliver_notify') return await onDeliver(event)
    if (name === 'xpay_refund_notify') return await onRefund(event)
    if (name === 'xpay_subscribe_ios_refund_query_notify') {
      return {
        ErrCode: 0,
        ErrMsg: 'success',
        IosRefundQueryResponse: {
          result_code: 1,
          result_info: '数字内容已发放',
          evidence: '用户已支付并获得氛围与主题开启权益，属虚拟内容一次性购买',
        },
      }
    }
    return OK
  } catch (e) {
    console.error('xpayNotify fail', e)
    return { ErrCode: -1, ErrMsg: (e && e.message) || 'fail' }
  }
}
