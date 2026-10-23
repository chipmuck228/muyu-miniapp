// 普通微信支付（微信支付商户平台 · JSAPI 小程序支付）
//
// 与 cloudfunctions/pay 的区别：
//   pay   = 虚拟支付（米大师 xpay）。iOS 端会走苹果 App 内支付，钱结算到 App Store Connect。
//   wxpay = 商户号收款。iOS / Android 两端完全一样，钱进商户号，在微信支付商户平台可见。
//
// 接口：微信支付 API v3，RSA-SHA256 签名。只用 Node 内置 crypto / https，无需安装依赖。
//
// 结果确认策略：不依赖异步回调（notify_url 是可选的）。
//   前端 wx.requestPayment success 后轮询 query 动作，服务端拿 out_trade_no 主动查单，
//   查到 trade_state === 'SUCCESS' 才写 users.premium。查单是权威结果，可重复调用。

const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')
const { wxpayConfig, wxpayReady } = require('./config')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const HOST = 'api.mch.weixin.qq.com'
const HTTP_TIMEOUT_MS = 5000

// 微信支付 v3 的 JSAPI 下单接口没有「道具 ID」这个概念，它只收
// appid / mchid / description / out_trade_no / notify_url / amount / payer。
// 所以这个值**不会发给微信**，仅作为我们落库时的内部标记，与虚拟支付的
// productId（那个必须与「道具管理」里的 ID 完全一致）是两回事，改名不影响任何在途订单。
const PRODUCT_TAG = 'premium'
// 未结算订单的复用期：这段时间内重复点击不会生成新的商户订单号
const ORDER_REUSE_MS = 24 * 60 * 60 * 1000
// 回收时最多检查多少张历史订单 / 总时间预算
const RECOVER_LIMIT = 20
const RECOVER_BUDGET_MS = 30000

const DEFAULT_SETTINGS = { soundOn: true, vibrateOn: true, autoMode: false, ambience: 'off', theme: 'dawn' }

function nonceStr() {
  return crypto.randomBytes(16).toString('hex')
}

function toMs(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  if (v.$date) return new Date(v.$date).getTime()
  const t = new Date(v).getTime()
  return isNaN(t) ? 0 : t
}

// ============ 微信支付 v3 签名与请求 ============

function rsaSign(privateKeyPem, message) {
  return crypto.createSign('RSA-SHA256').update(message, 'utf8').sign(privateKeyPem, 'base64')
}

function authorization(cfg, method, urlPath, timestamp, nc, body) {
  const message = method + '\n' + urlPath + '\n' + timestamp + '\n' + nc + '\n' + body + '\n'
  const sig = rsaSign(cfg.privateKey, message)
  return (
    'WECHATPAY2-SHA256-RSA2048 mchid="' +
    cfg.mchid +
    '",nonce_str="' +
    nc +
    '",signature="' +
    sig +
    '",timestamp="' +
    timestamp +
    '",serial_no="' +
    cfg.serialNo +
    '"'
  )
}

function mchRequest(cfg, method, urlPath, bodyObj) {
  return new Promise((resolve, reject) => {
    const data = bodyObj ? JSON.stringify(bodyObj) : ''
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nc = nonceStr()
    let auth
    try {
      auth = authorization(cfg, method, urlPath, timestamp, nc, data)
    } catch (e) {
      reject(new Error('商户私钥无效：' + ((e && e.message) || '')))
      return
    }
    const req = https.request(
      {
        host: HOST,
        port: 443,
        path: urlPath,
        method,
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'miniprogram-wxpay-v3',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => {
          raw += c
        })
        res.on('end', () => {
          let json = null
          try {
            json = raw ? JSON.parse(raw) : {}
          } catch (e) {
            json = null
          }
          resolve({ status: res.statusCode || 0, body: json, raw })
        })
      }
    )
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('微信支付接口超时')))
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

// JSAPI 下单，返回 prepay_id
async function jsapiPrepay(cfg, openid, outTradeNo, amountFen) {
  const body = {
    appid: cfg.appid,
    mchid: cfg.mchid,
    description: String(cfg.description || '会员开通').slice(0, 127),
    out_trade_no: outTradeNo,
    amount: { total: amountFen, currency: 'CNY' },
    payer: { openid },
  }
  if (cfg.notifyUrl) body.notify_url = cfg.notifyUrl

  const r = await mchRequest(cfg, 'POST', '/v3/pay/transactions/jsapi', body)
  if (r.status === 200 && r.body && r.body.prepay_id) return r.body.prepay_id
  const code = (r.body && (r.body.code || r.body.errcode)) || ''
  const msg = (r.body && (r.body.message || r.body.errmsg)) || r.raw || '下单失败'
  const err = new Error(String(msg))
  err.mchCode = String(code)
  err.httpStatus = r.status
  throw err
}

// 按商户订单号查单。返回订单对象，查不到返回 null
async function queryOrder(cfg, outTradeNo) {
  const urlPath =
    '/v3/pay/transactions/out-trade-no/' + encodeURIComponent(outTradeNo) + '?mchid=' + encodeURIComponent(cfg.mchid)
  const r = await mchRequest(cfg, 'GET', urlPath, null)
  if (r.status === 200 && r.body && r.body.out_trade_no) return r.body
  return null
}

// 由 prepay_id 生成前端 wx.requestPayment 所需的参数（服务端签好名再下发）
function clientPayParams(cfg, prepayId) {
  const timeStamp = String(Math.floor(Date.now() / 1000))
  const nc = nonceStr()
  const pkg = 'prepay_id=' + prepayId
  const message = cfg.appid + '\n' + timeStamp + '\n' + nc + '\n' + pkg + '\n'
  return {
    timeStamp,
    nonceStr: nc,
    package: pkg,
    signType: 'RSA',
    paySign: rsaSign(cfg.privateKey, message),
  }
}

// ============ 数据库 ============

async function getUser(openid) {
  try {
    const r = await db.collection('users').doc(openid).get()
    return r.data || null
  } catch (e) {
    return null
  }
}

async function ensureOrders() {
  try {
    await db.createCollection('premium_orders')
  } catch (e) {
    // 已存在
  }
}

async function listMyOrders(openid) {
  try {
    const r = await db
      .collection('premium_orders')
      .where({ _openid: openid, status: 'created', channel: 'wxpay' })
      .limit(50)
      .get()
    const rows = (r.data || []).filter((o) => o && o.outTradeNo)
    rows.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
    return rows
  } catch (e) {
    console.warn('listMyOrders', e && e.message)
    return []
  }
}

function newTradeNo() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let tail = ''
  for (let i = 0; i < 8; i++) tail += chars.charAt(Math.floor(Math.random() * chars.length))
  // 微信支付要求 6-32 位、数字字母 _-|* 组成、不能以下划线开头
  return ('w' + Date.now().toString(36) + tail).slice(0, 32)
}

async function markOrderPaid(openid, outTradeNo, extra) {
  if (!outTradeNo) return
  try {
    const r = await db.collection('premium_orders').where({ outTradeNo }).limit(1).get()
    const row = r.data && r.data[0]
    if (!row) return
    const patch = {
      status: 'delivered',
      deliveredAt: db.serverDate(),
      channel: 'wxpay',
      paidFee: (extra && extra.paidFee) || 0,
    }
    if (extra && extra.transactionId) patch.transactionId = extra.transactionId
    await db.collection('premium_orders').doc(row._id).update({ data: patch })
  } catch (e) {
    console.warn('markOrderPaid', outTradeNo, e && e.message)
  }
}

// 发货：把 users.premium 置为 true，并把订单标记为 delivered
async function grantPremium(openid, outTradeNo, extra) {
  const users = db.collection('users')
  let user = await getUser(openid)
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
        createdAt: db.serverDate(),
        lastHitDate: null,
        settings: Object.assign({}, DEFAULT_SETTINGS),
      },
    })
  } else if (user.premium !== true) {
    await users.doc(openid).update({ data: { premium: true, premiumAt: db.serverDate() } })
  }
  await markOrderPaid(openid, outTradeNo, extra || {})
}

// 回收：扫自己所有未结算订单，问微信有没有真的付过。付过就补发货。
async function recoverPaid(openid, cfg) {
  try {
    const rows = await listMyOrders(openid)
    const deadline = Date.now() + RECOVER_BUDGET_MS
    for (let i = 0; i < rows.length && i < RECOVER_LIMIT; i++) {
      const no = rows[i].outTradeNo
      if (Date.now() > deadline) {
        console.warn('wxpay recover budget out', i)
        return false
      }
      let order = null
      try {
        order = await queryOrder(cfg, no)
      } catch (e) {
        console.warn('wxpay recover query', no, e && e.message)
        continue
      }
      if (order && order.trade_state === 'SUCCESS') {
        await grantPremium(openid, no, {
          paidFee: order.amount && order.amount.total,
          transactionId: order.transaction_id || '',
        })
        return true
      }
    }
    return false
  } catch (e) {
    console.error('wxpay recoverPaid', e && e.message)
    return false
  }
}

// ============ 动作 ============

async function prepay(openid) {
  const cfg = wxpayConfig()
  if (!wxpayReady(cfg)) {
    return { ok: false, code: 'wxpay_config', msg: '微信支付未配置：请检查 wxpay/secrets.js 的 appid / mchid / serialNo / privateKey / price' }
  }
  await ensureOrders()

  const user = await getUser(openid)
  if (user && user.premium === true) return { ok: true, premium: true, already: true }

  // 先回收：历史上若有已付款但没发货的单，直接补上，不再让用户付第二次
  const recovered = await recoverPaid(openid, cfg)
  if (recovered) return { ok: true, premium: true, already: true }

  // 幂等：复用同一张未结算订单，避免重复生成商户订单号
  const rows = await listMyOrders(openid)
  const now = Date.now()
  let reuse = null
  for (let i = 0; i < rows.length; i++) {
    const t = toMs(rows[i].createdAt)
    if (!t || now - t > ORDER_REUSE_MS) continue
    reuse = rows[i]
    break
  }

  let outTradeNo = reuse ? reuse.outTradeNo : newTradeNo()
  let prepayId = ''
  try {
    prepayId = await jsapiPrepay(cfg, openid, outTradeNo, cfg.price)
  } catch (e) {
    // 订单号已被用过：多半是上一笔其实已付款，查一次再决定
    try {
      const order = await queryOrder(cfg, outTradeNo)
      if (order && order.trade_state === 'SUCCESS') {
        await grantPremium(openid, outTradeNo, {
          paidFee: order.amount && order.amount.total,
          transactionId: order.transaction_id || '',
        })
        return { ok: true, premium: true, already: true }
      }
    } catch (e2) {
      console.warn('wxpay requery', e2 && e2.message)
    }
    throw e
  }

  if (!reuse) {
    await db.collection('premium_orders').add({
      data: {
        outTradeNo,
        _openid: openid,
        channel: 'wxpay',
        productId: PRODUCT_TAG,
        goodsPrice: cfg.price,
        status: 'created',
        createdAt: db.serverDate(),
        deliveredAt: null,
      },
    })
  }

  return {
    ok: true,
    premium: false,
    outTradeNo,
    goodsPrice: cfg.price,
    reused: !!reuse,
    ...clientPayParams(cfg, prepayId),
  }
}

async function confirm(openid, outTradeNo) {
  try {
    const user = await getUser(openid)
    if (user && user.premium === true) return { ok: true, premium: true }

    const cfg = wxpayConfig()
    if (!wxpayReady(cfg) || !outTradeNo) return { ok: true, premium: false }

    const order = await queryOrder(cfg, outTradeNo)
    if (order && order.trade_state === 'SUCCESS') {
      await grantPremium(openid, outTradeNo, {
        paidFee: order.amount && order.amount.total,
        transactionId: order.transaction_id || '',
      })
      // 收款后再次读一遍，确保返回的是最新状态
      const fresh = await getUser(openid)
      return { ok: true, premium: !!(fresh && fresh.premium === true) }
    }
    return { ok: true, premium: false, tradeState: (order && order.trade_state) || 'NOTFOUND' }
  } catch (e) {
    console.error('wxpay confirm', e && e.message)
    return { ok: true, premium: false, msg: (e && e.message) || '' }
  }
}

// ===== 退款复核 =====
// 在商户平台给用户退款后，微信侧该订单的 trade_state 会变成 REFUND。
// 本实现没有可用的异步回调（notify_url 是占位地址），所以改为在用户端主动复核：
// 只要发现订单已退款，立刻收回 premium，高级功能随之失效。

async function findDeliveredOrder(openid) {
  try {
    const r = await db
      .collection('premium_orders')
      .where({ _openid: openid, channel: 'wxpay', status: 'delivered' })
      .limit(10)
      .get()
    const rows = (r.data || []).filter((o) => o && o.outTradeNo)
    if (!rows.length) return null
    rows.sort((a, b) => toMs(b.deliveredAt) - toMs(a.deliveredAt))
    return rows[0]
  } catch (e) {
    console.warn('findDeliveredOrder', e && e.message)
    return null
  }
}

async function revokePremium(openid, outTradeNo) {
  try {
    await db.collection('users').doc(openid).update({
      data: { premium: false, premiumRevokedAt: db.serverDate() },
    })
  } catch (e) {
    console.warn('revokePremium user', openid, e && e.message)
  }
  if (!outTradeNo) return
  try {
    const r = await db.collection('premium_orders').where({ outTradeNo }).limit(1).get()
    const row = r.data && r.data[0]
    if (!row) return
    await db.collection('premium_orders').doc(row._id).update({
      data: { status: 'refunded', refundedAt: db.serverDate() },
    })
  } catch (e) {
    console.warn('revokePremium order', outTradeNo, e && e.message)
  }
}

async function verify(openid) {
  // 复核失败一律不收回权益：宁可让用户多用一会儿，也不能因为网络抖动误伤付费用户
  try {
    const user = await getUser(openid)
    if (!user || user.premium !== true) return { ok: true, premium: false, refunded: false }

    const cfg = wxpayConfig()
    if (!wxpayReady(cfg)) return { ok: true, premium: true, refunded: false }

    const row = await findDeliveredOrder(openid)
    if (!row) return { ok: true, premium: true, refunded: false }

    const order = await queryOrder(cfg, row.outTradeNo)
    if (!order) return { ok: true, premium: true, refunded: false }

    if (order.trade_state === 'REFUND') {
      await revokePremium(openid, row.outTradeNo)
      console.warn('refund revoked premium', openid, row.outTradeNo)
      return { ok: true, premium: false, refunded: true, outTradeNo: row.outTradeNo }
    }
    return { ok: true, premium: true, refunded: false, tradeState: order.trade_state }
  } catch (e) {
    console.warn('wxpay verify', e && e.message)
    return { ok: true, premium: true, refunded: false }
  }
}

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) return { ok: false, msg: '未获取到 openid' }
    const action = (event && event.action) || 'prepay'
    if (action === 'prepay') return await prepay(OPENID)
    if (action === 'query') return await confirm(OPENID, event && event.outTradeNo)
    if (action === 'verify') return await verify(OPENID)
    return { ok: false, msg: '未知操作' }
  } catch (e) {
    const mchCode = e && e.mchCode
    const httpStatus = e && e.httpStatus
    console.error(
      'wxpay main',
      'mchCode=' + (mchCode || '-'),
      'http=' + (httpStatus || '-'),
      (e && e.message) || e
    )
    return {
      ok: false,
      code: mchCode || 'wxpay_fail',
      // 把微信的错误码一并带上，商户号被限制时只有看得到 code 才能对症处理
      msg: mchCode ? '微信支付[' + mchCode + ']：' + (e.message || '') : (e && e.message) || '支付准备失败',
    }
  }
}
