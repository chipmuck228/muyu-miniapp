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
// 微信支付规定：单笔订单的分账比例上限 30%，超过会被拒绝
const SPLIT_RATE_MAX = 0.3
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
async function jsapiPrepay(cfg, openid, outTradeNo, amountFen, profitSharing) {
  const body = {
    appid: cfg.appid,
    mchid: cfg.mchid,
    description: String(cfg.description || '会员开通').slice(0, 127),
    out_trade_no: outTradeNo,
    amount: { total: amountFen, currency: 'CNY' },
    payer: { openid },
  }
  if (cfg.notifyUrl) body.notify_url = cfg.notifyUrl
  // 只有下单时标记了 profit_sharing 的订单才允许分账。
  // 但标记后这笔资金会被冻结，所以只在「确定要分账」时才标记，绝不能无脑全开。
  if (profitSharing) body.settle_info = { profit_sharing: true }

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
  // 付款成功后按渠道费率记佣金。幂等 + 失败不阻断：
  // 佣金记账出问题绝不能影响已经付了钱的用户拿到权益
  await recordCommission(openid, outTradeNo, (extra && extra.paidFee) || 0)
  // 分账：需 WXPAY_SPLIT=1 且该渠道配了接收方。同样是失败不阻断
  await splitForOrder(
    openid,
    outTradeNo,
    (extra && extra.transactionId) || '',
    (extra && extra.paidFee) || 0
  )
}

// ===== 渠道佣金 =====
// 记账 + 可选的微信分账（splitForOrder，需 WXPAY_SPLIT=1，默认关闭）。
// 佣金金额 = 实付金额 × 渠道费率，费率上限 0.3，与 createOrder 的口径保持一致。
// 真正的结算由管理员在渠道管理页按月标记，这里只负责产生佣金记录。

async function recordCommission(openid, outTradeNo, amount) {
  if (!openid || !outTradeNo) return
  try {
    let amt = parseInt(amount, 10)
    if (!(amt > 0)) {
      // 兜底：个别路径拿不到 paidFee，回落到订单上的标价
      const r = await db.collection('premium_orders').where({ outTradeNo }).limit(1).get()
      const row = r.data && r.data[0]
      amt = parseInt(row && row.goodsPrice, 10)
    }
    if (!(amt > 0)) return

    // 幂等：同一单只记一次。发货后用户反复进页面会走 confirm，不能重复计佣
    const dup = await db.collection('channel_commissions').where({ outTradeNo }).limit(1).get()
    if (dup.data && dup.data.length) return

    const bind = await db.collection('channel_users').where({ _openid: openid }).limit(1).get()
    const rel = bind.data && bind.data[0]
    if (!rel || !rel.channelId) return // 非渠道用户，没有佣金

    const ch = await db.collection('channels').doc(rel.channelId).get().catch(() => null)
    const channel = ch && ch.data
    if (!channel || channel.status !== 'active') return

    let rate = Number(channel.commissionRate)
    if (!(rate > 0)) return
    if (rate > 0.3) rate = 0.3
    const commissionAmount = Math.floor(amt * rate)
    if (commissionAmount <= 0) return

    await db.collection('channel_commissions').add({
      data: {
        channelId: rel.channelId,
        userId: openid,
        // 直接存微信支付商户单号，跟 premium_orders.outTradeNo 对齐，
        // 将来拿它去 pay.weixin.qq.com 对账不用再做换算
        orderId: outTradeNo,
        outTradeNo,
        orderAmount: amt,
        commissionAmount,
        rate,
        status: 'pending',
        source: 'wxpay',
        createdAt: db.serverDate(),
        settledAt: null,
        title: '静心包',
      },
    })
  } catch (e) {
    console.warn('recordCommission', outTradeNo, e && e.message)
  }
}

// 退款后冲销佣金：置为 failed，getChannelStats 会跳过 failed 的记录，
// 避免已退款的订单继续被算作渠道的「付费数」和「佣金」。
async function voidCommission(outTradeNo) {
  if (!outTradeNo) return
  try {
    const r = await db.collection('channel_commissions').where({ outTradeNo }).limit(1).get()
    const row = r.data && r.data[0]
    if (!row || row.status === 'failed') return
    await db.collection('channel_commissions').doc(row._id).update({
      data: { status: 'failed', voidedAt: db.serverDate(), voidReason: 'refunded' },
    })
  } catch (e) {
    console.warn('voidCommission', outTradeNo, e && e.message)
  }
}

// ===== 微信支付分账 =====
// 前置条件（缺一不可，否则分账会直接失败）：
//   1. 商户平台 → 产品中心 → 已开通「分账」产品（通常要求入驻满 90 天且近期有连续交易）
//   2. 配置打开：环境变量 WXPAY_SPLIT=1，比例 WXPAY_SPLIT_RATE=0.2
//   3. 渠道在 channels 里配好了接收方：splitAccount / splitType
//   4. 该接收方已通过 addReceiver 接口登记过
//   5. 下单时带了 settle_info.profit_sharing（由 prepay 自动判断）
// 风险提示：标记 profit_sharing 后资金被冻结，必须分账或解冻，否则一直挂账。
// 且已分账的订单最多只能退「未分账部分」，全额退款会失败。

// 找出该用户所属渠道的分账接收方。没绑渠道 / 渠道未激活 / 没配接收方 → 返回 null
async function splitTargetOf(openid, cfg) {
  if (!cfg || !cfg.splitEnabled) return null
  try {
    const bind = await db.collection('channel_users').where({ _openid: openid }).limit(1).get()
    const rel = bind.data && bind.data[0]
    if (!rel || !rel.channelId) return null
    const ch = await db.collection('channels').doc(rel.channelId).get().catch(() => null)
    const channel = ch && ch.data
    if (!channel || channel.status !== 'active') return null
    const account = String(channel.splitAccount || '').trim()
    if (!account) return null
    return {
      channelId: rel.channelId,
      account,
      // PERSONAL_OPENID 分给个人微信零钱；MERCHANT_ID 分给另一个商户号
      type: String(channel.splitType || 'PERSONAL_OPENID').trim(),
      name: String(channel.splitName || '').trim(),
    }
  } catch (e) {
    console.warn('splitTargetOf', e && e.message)
    return null
  }
}

// 分账单号：商户号下唯一，64 字符内。由商户订单号派生，方便对账
function newSplitNo(outTradeNo) {
  return ('S' + String(outTradeNo)).slice(0, 64)
}

async function requestSplit(cfg, transactionId, outOrderNo, receiver, amount) {
  const rcv = { type: receiver.type, account: receiver.account, amount, description: '渠道推广分账' }
  // name 仅 MERCHANT_ID 必填；个人类型且金额 ≥ 2000 元时必填且需用平台证书加密，这里不涉及
  if (receiver.name) rcv.name = receiver.name
  const body = {
    appid: cfg.appid,
    mchid: cfg.mchid,
    transaction_id: transactionId,
    out_order_no: outOrderNo,
    receivers: [rcv],
    // 分账后自动解冻剩余未分账资金，避免一直冻结
    unfreeze_unsplit: true,
  }
  const r = await mchRequest(cfg, 'POST', '/v3/profitsharing/orders', body)
  if (r.status === 200 && r.body && r.body.out_order_no) return r.body
  const code = (r.body && (r.body.code || r.body.errcode)) || ''
  const msg = (r.body && (r.body.message || r.body.errmsg)) || r.raw || '分账失败'
  const err = new Error(String(msg))
  err.mchCode = String(code)
  err.httpStatus = r.status
  throw err
}

// 支付成功后发起分账。全程 try/catch，任何失败都不影响用户已获得的权益
async function splitForOrder(openid, outTradeNo, transactionId, amount) {
  try {
    const cfg = wxpayConfig()
    if (!cfg.splitEnabled || !wxpayReady(cfg)) return
    const target = await splitTargetOf(openid, cfg)
    if (!target) return // 非渠道用户，无需分账

    const amt = parseInt(amount, 10)
    if (!(amt > 0)) return
    let rate = Number(cfg.splitRate)
    if (!(rate > 0)) return
    if (rate > SPLIT_RATE_MAX) rate = SPLIT_RATE_MAX
    const splitAmount = Math.floor(amt * rate)
    if (splitAmount < 1) return // 不足 1 分不分

    const txId = String(transactionId || '').trim()
    if (!txId) {
      console.warn('splitForOrder 缺少 transaction_id', outTradeNo)
      return
    }

    const outOrderNo = newSplitNo(outTradeNo)
    const r = await db.collection('channel_commissions').where({ outTradeNo }).limit(1).get()
    const row = r.data && r.data[0]
    // 幂等：已成功或已失败的单不再自动重试，避免重复分账
    if (row && (row.splitStatus === 'shared' || row.splitStatus === 'failed')) return

    try {
      const res = await requestSplit(cfg, txId, outOrderNo, target, splitAmount)
      // 分账是异步的：返回 PROCESSING 表示处理中，FINISHED 才是完成
      const done = res.status === 'FINISHED'
      if (row) {
        await db.collection('channel_commissions').doc(row._id).update({
          data: {
            splitStatus: done ? 'shared' : 'processing',
            splitOrderNo: outOrderNo,
            splitAmount,
            splitRate: rate,
            splitAt: db.serverDate(),
            splitRaw: String(res.status || ''),
          },
        })
      }
      console.warn('split ok', outTradeNo, splitAmount, res.status)
    } catch (e) {
      if (row) {
        await db.collection('channel_commissions').doc(row._id).update({
          data: {
            splitStatus: 'failed',
            splitOrderNo: outOrderNo,
            splitAmount,
            splitMsg: (e && e.message) || '',
            splitCode: (e && e.mchCode) || '',
          },
        })
      }
      console.warn('split failed', outTradeNo, (e && e.mchCode) || '', (e && e.message) || '')
    }
  } catch (e) {
    console.warn('splitForOrder', outTradeNo, e && e.message)
  }
}

// 查询分账结果（异步分账需要轮询确认）
async function querySplit(cfg, outOrderNo, transactionId) {
  const urlPath =
    '/v3/profitsharing/orders/out-order-no/' +
    encodeURIComponent(outOrderNo) +
    '?mchid=' +
    encodeURIComponent(cfg.mchid) +
    '&transaction_id=' +
    encodeURIComponent(transactionId)
  const r = await mchRequest(cfg, 'GET', urlPath, null)
  if (r.status === 200 && r.body && r.body.out_order_no) return r.body
  const code = (r.body && (r.body.code || r.body.errcode)) || ''
  const msg = (r.body && (r.body.message || r.body.errmsg)) || r.raw || '查询分账失败'
  const err = new Error(String(msg))
  err.mchCode = String(code)
  err.httpStatus = r.status
  throw err
}

// 解冻：分账失败或不打算分账时，必须解冻，否则资金一直冻结无法结算
async function unfreezeOrder(cfg, outOrderNo, transactionId, description) {
  const body = {
    transaction_id: transactionId,
    out_order_no: outOrderNo,
    description: String(description || '解冻未分账资金').slice(0, 80),
  }
  const r = await mchRequest(cfg, 'POST', '/v3/profitsharing/orders/unfreeze', body)
  if (r.status === 200 && r.body) return r.body
  const code = (r.body && (r.body.code || r.body.errcode)) || ''
  const msg = (r.body && (r.body.message || r.body.errmsg)) || r.raw || '解冻失败'
  const err = new Error(String(msg))
  err.mchCode = String(code)
  err.httpStatus = r.status
  throw err
}

// 添加分账接收方（渠道必须在 channels 里先配好 splitAccount / splitType）
async function addReceiver(cfg, type, account, name, relationType) {
  const body = {
    appid: cfg.appid,
    mchid: cfg.mchid,
    type: String(type || 'PERSONAL_OPENID').trim(),
    account: String(account || '').trim(),
    relation_type: String(relationType || 'DISTRIBUTOR').trim(),
  }
  if (name) body.name = String(name).trim()
  const r = await mchRequest(cfg, 'POST', '/v3/profitsharing/receivers/add', body)
  if (r.status === 200 && r.body) return r.body
  const code = (r.body && (r.body.code || r.body.errcode)) || ''
  const msg = (r.body && (r.body.message || r.body.errmsg)) || r.raw || '添加接收方失败'
  const err = new Error(String(msg))
  err.mchCode = String(code)
  err.httpStatus = r.status
  throw err
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
    // 改价后不能复用旧价订单：同一个 outTradeNo 以新金额重新下单会被微信拒绝，
    // 用户点支付只会看到失败。金额不一致就新建单号。
    if (Number(rows[i].goodsPrice) !== cfg.price) continue
    reuse = rows[i]
    break
  }

  let outTradeNo = reuse ? reuse.outTradeNo : newTradeNo()
  // 只有「分账已开启」且「该用户所属渠道配好了接收方」才把这单标记成可分账。
  // 复用旧单时不再改标记：改了会与原订单信息冲突导致下单失败。
  const splitTarget = cfg.splitEnabled && !reuse ? await splitTargetOf(openid, cfg) : null
  let prepayId = ''
  try {
    prepayId = await jsapiPrepay(cfg, openid, outTradeNo, cfg.price, !!splitTarget)
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
// 在商户平台给用户退款后，微信侧该订单的 trade_state 会变成 REFUND（全额退款）。
// 本实现没有可用的异步回调（notify_url 是占位地址），所以改为在用户端主动复核：
// 只要发现已发货订单全部退款，立刻把用户彻底恢复成未付费状态。
//
// 已知边界：部分退款时微信查单仍返回 SUCCESS，这里检测不到；19.9 元买断一般全额退。

async function findDeliveredOrders(openid) {
  try {
    const r = await db
      .collection('premium_orders')
      .where({ _openid: openid, channel: 'wxpay', status: 'delivered' })
      .limit(20)
      .get()
    return (r.data || []).filter((o) => o && o.outTradeNo)
  } catch (e) {
    console.warn('findDeliveredOrders', e && e.message)
    return []
  }
}

async function markOrderRefunded(outTradeNo) {
  if (!outTradeNo) return
  // 退款同步冲销佣金，否则已退款的订单仍会被算进渠道的付费数和佣金
  await voidCommission(outTradeNo)
  try {
    const r = await db.collection('premium_orders').where({ outTradeNo }).limit(1).get()
    const row = r.data && r.data[0]
    if (!row) return
    await db.collection('premium_orders').doc(row._id).update({
      data: { status: 'refunded', refundedAt: db.serverDate() },
    })
  } catch (e) {
    console.warn('markOrderRefunded', outTradeNo, e && e.message)
  }
}

// 彻底恢复到未付费状态：清 premium / premiumAt，把锁定的氛围与主题降回免费档。
// 后者必须写库，不能只靠读取时降级——否则用户下次重新付费会突然「自动恢复」旧偏好。
async function revokePremium(openid, refundedNos) {
  const _ = db.command
  const patch = {
    premium: false,
    premiumAt: _.remove(),
    premiumRevokedAt: db.serverDate(),
  }
  try {
    const user = await getUser(openid)
    // 写整个 settings 对象，不用 'settings.ambience' 点路径：
    // 点路径在 settings 不存在时会让整条 update 失败，连 premium:false 都写不进去。
    const s = Object.assign({}, (user && user.settings) || {})
    const premiumAmbience = { noise: 1, stream: 1, pine: 1, fire: 1 }
    const premiumTheme = { night: 1, ink: 1, dusk: 1 }
    let changed = false
    if (premiumAmbience[s.ambience]) { s.ambience = 'off'; changed = true }
    if (premiumTheme[s.theme]) { s.theme = 'dawn'; changed = true }
    if (changed) patch.settings = s
  } catch (e) {
    console.warn('revokePremium settings', openid, e && e.message)
  }
  try {
    await db.collection('users').doc(openid).update({ data: patch })
  } catch (e) {
    console.warn('revokePremium user', openid, e && e.message)
  }
  for (let i = 0; i < refundedNos.length; i++) await markOrderRefunded(refundedNos[i])
}

async function verify(openid) {
  // 复核失败一律不收回权益：宁可让用户多用一会儿，也不能因为网络抖动误伤付费用户
  try {
    const user = await getUser(openid)
    if (!user || user.premium !== true) return { ok: true, premium: false, refunded: false }

    const cfg = wxpayConfig()
    if (!wxpayReady(cfg)) return { ok: true, premium: true, refunded: false }

    const rows = await findDeliveredOrders(openid)
    if (!rows.length) return { ok: true, premium: true, refunded: false }

    const refunded = []
    let stillPaid = false
    for (let i = 0; i < rows.length; i++) {
      const order = await queryOrder(cfg, rows[i].outTradeNo)
      // 查不到或仍是 SUCCESS 都当作这笔还有效，绝不因网络抖动收回权益
      if (order && (order.trade_state === 'REFUND' || order.trade_state === 'REVOKED')) {
        refunded.push(rows[i].outTradeNo)
      } else {
        stillPaid = true
      }
    }
    if (!refunded.length) return { ok: true, premium: true, refunded: false }

    // 只要还留着一笔有效付款，就不收回权益，仅把已退的那几笔标记掉
    if (stillPaid) {
      for (let i = 0; i < refunded.length; i++) await markOrderRefunded(refunded[i])
      return { ok: true, premium: true, refunded: false }
    }

    await revokePremium(openid, refunded)
    console.warn('refund revoked premium', openid, refunded.join(','))
    return { ok: true, premium: false, refunded: true, outTradeNo: refunded[0], count: refunded.length }
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
    // 静心包介绍面板提前显示价格：只读配置，不下单
    if (action === 'price') {
      const cfg = wxpayConfig()
      return { ok: true, price: wxpayReady(cfg) ? cfg.price : 0 }
    }
    // ---- 管理动作：需要 adminKey 口令（配置 WXPAY_ADMIN_KEY）----
    if (action === 'splitQuery' || action === 'unfreeze' || action === 'addReceiver') {
      const cfg = wxpayConfig()
      if (!cfg.adminKey || String((event && event.adminKey) || '') !== cfg.adminKey) {
        return { ok: false, msg: '口令不正确，或未配置 WXPAY_ADMIN_KEY' }
      }
      if (action === 'addReceiver') {
        const res = await addReceiver(cfg, event.type, event.account, event.name, event.relationType)
        return { ok: true, receiver: res }
      }
      const no = String((event && event.outTradeNo) || '').trim()
      if (!no) return { ok: false, msg: '缺少 outTradeNo' }
      const ord = await db.collection('premium_orders').where({ outTradeNo: no }).limit(1).get()
      const row = ord.data && ord.data[0]
      const txId = String((row && row.transactionId) || '').trim()
      if (!txId) return { ok: false, msg: '该订单没有 transaction_id，无法分账或解冻' }
      if (action === 'splitQuery') {
        return { ok: true, split: await querySplit(cfg, newSplitNo(no), txId) }
      }
      return { ok: true, unfreeze: await unfreezeOrder(cfg, newSplitNo(no), txId, event.description) }
    }
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
