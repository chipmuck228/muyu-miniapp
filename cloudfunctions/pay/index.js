const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')
const { payConfig } = require('./config')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PRODUCT_TAG = 'premium'

// 单个 HTTPS 查询的上限。云函数整体超时只有 60s，这里必须留出足够余量。
const QUERY_TIMEOUT_MS = 4000
// recoverPaid 的总预算：宁可少查几张，也不能把云函数拖超时。
const RECOVER_BUDGET_MS = 30000
// 回收时最多检查多少张历史订单
const RECOVER_LIMIT = 20
// 未结算订单的复用期：这段时间内重复点击不会生成新的业务订单号
const ORDER_REUSE_MS = 24 * 60 * 60 * 1000

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let raw = ''
        res.on('data', (c) => {
          raw += c
        })
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw || '{}'))
          } catch (e) {
            reject(new Error('登录接口返回异常'))
          }
        })
      })
      .on('error', reject)
  })
}

function httpsPostJson(fullUrl, body) {
  const data = typeof body === 'string' ? body : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const m = String(fullUrl).match(/^https:\/\/([^/]+)(\/[^?]*)(\?.*)?$/)
    if (!m) {
      reject(new Error('查询地址无效'))
      return
    }
    const req = https.request(
      {
        hostname: m[1],
        path: m[2] + (m[3] || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => {
          raw += c
        })
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw || '{}'))
          } catch (e) {
            reject(new Error('支付查询返回异常'))
          }
        })
      }
    )
    req.setTimeout(QUERY_TIMEOUT_MS, () => {
      req.destroy(new Error('支付查询超时'))
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

let tokenCache = { token: '', exp: 0 }

async function accessToken(appId, appSecret) {
  if (!appId || !appSecret) throw new Error('缺少 AppID 或 AppSecret')
  if (tokenCache.token && tokenCache.exp > Date.now() + 60 * 1000) return tokenCache.token
  const url =
    'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' +
    encodeURIComponent(appId) +
    '&secret=' +
    encodeURIComponent(appSecret)
  const r = await httpsGetJson(url)
  if (!r || !r.access_token) {
    throw new Error((r && r.errmsg) || '未能取得接口凭证')
  }
  tokenCache = { token: r.access_token, exp: Date.now() + (r.expires_in || 7200) * 1000 }
  return r.access_token
}

function paidStatus(status) {
  const n = Number(status)
  return n === 2 || n === 3 || n === 4
}

function hmacHex(key, msg) {
  return crypto.createHmac('sha256', String(key || '')).update(String(msg || ''), 'utf8').digest('hex')
}

async function queryXpayOrder(cfg, appId, openid, orderId) {
  const postBody = JSON.stringify({
    openid: String(openid || ''),
    env: Number(cfg.env) === 1 ? 1 : 0,
    order_id: String(orderId || ''),
  })
  const paySig = hmacHex(cfg.appKey, '/xpay/query_order&' + postBody)
  const token = await accessToken(appId, cfg.appSecret)
  const url =
    'https://api.weixin.qq.com/xpay/query_order?access_token=' +
    encodeURIComponent(token) +
    '&pay_sig=' +
    encodeURIComponent(paySig)
  const r = await httpsPostJson(url, postBody)
  if (r && r.errcode) {
    console.warn('query_order', orderId, r.errcode, r.errmsg)
    return null
  }
  return (r && r.order) || null
}

function buildSignData(cfg, outTradeNo, openid) {
  const body = {
    offerId: cfg.offerId,
    buyQuantity: 1,
    env: cfg.env,
    currencyType: 'CNY',
    productId: cfg.productId,
    goodsPrice: cfg.goodsPrice,
    outTradeNo,
    attach: PRODUCT_TAG + '|' + openid,
  }
  return JSON.stringify(body)
}

function newTradeNo() {
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 8)
  return ('p' + t + r).slice(0, 32)
}

async function ensureOrders() {
  try {
    await db.createCollection('premium_orders')
  } catch (e) {
    // exists
  }
}

async function getUser(openid) {
  try {
    const r = await db.collection('users').doc(openid).get()
    return r.data || null
  } catch (e) {
    return null
  }
}

async function sessionKeyOf(jsCode, appId, appSecret) {
  const code = String(jsCode || '').trim()
  if (!code) throw new Error('缺少登录码')
  if (!appId) throw new Error('缺少 AppID')
  if (!appSecret) throw new Error('请在 pay/secrets.js 填写小程序 AppSecret')
  const url =
    'https://api.weixin.qq.com/sns/jscode2session?appid=' +
    encodeURIComponent(appId) +
    '&secret=' +
    encodeURIComponent(appSecret) +
    '&js_code=' +
    encodeURIComponent(code) +
    '&grant_type=authorization_code'
  const r = await httpsGetJson(url)
  if (r && r.errcode) {
    throw new Error((r.errmsg || '登录校验失败') + ' (' + r.errcode + ')')
  }
  const key = (r && r.session_key) || ''
  if (!key) throw new Error('未能取得会话密钥')
  return key
}

async function markOrderDelivered(outTradeNo, extra) {
  if (!outTradeNo) return
  try {
    const r = await db.collection('premium_orders').where({ outTradeNo }).limit(1).get()
    const row = r.data && r.data[0]
    if (!row) return
    await db.collection('premium_orders').doc(row._id).update({
      data: Object.assign(
        {
          status: 'delivered',
          deliveredAt: db.serverDate(),
        },
        extra || {}
      ),
    })
  } catch (e) {
    console.warn('markOrderDelivered', e && e.message)
  }
}

async function grantPremium(openid, orderPatch) {
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
  if (orderPatch && orderPatch.outTradeNo) {
    await markOrderDelivered(orderPatch.outTradeNo, orderPatch.extra || {})
  }
}

function toMs(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'object' && typeof v.getTime === 'function') return v.getTime()
  const n = Date.parse(String(v))
  return isNaN(n) ? 0 : n
}

// 历史订单不再截断到 5 条：每次点击都会留一张 created 行，
// 截断会让真正付过款的那张单永久滚出回收窗口，必然导致重复扣费。
async function listMyOrders(openid) {
  try {
    const r = await db.collection('premium_orders').where({ _openid: openid }).limit(50).get()
    const rows = (r.data || []).filter((o) => o && o.outTradeNo && o.status !== 'refunded')
    rows.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
    return rows
  } catch (e) {
    console.warn('listMyOrders', e && e.message)
    return []
  }
}

// 找出可以复用的未结算订单。支付已发起但尚未确认时，重复点击应回到同一张单，
// 而不是再生成一个 outTradeNo 让用户二次付费。
async function findResumableOrder(openid, cfg) {
  // 注意：这里刻意不按 productId 过滤。本小程序只卖一个「一次开启」道具，
  // 一旦道具 ID 改名（premium_unlock → Premium），严格过滤会让改名前留下的未结算订单
  // 全部失配，从而又给用户开出一张新单 —— 正是我们要防的重复扣费。
  const rows = await listMyOrders(openid)
  const now = Date.now()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.status !== 'created') continue
    const t = toMs(row.createdAt)
    if (!t || now - t > ORDER_REUSE_MS) continue
    return row
  }
  return null
}

async function recoverPaid(openid, cfg, appId) {
  try {
    if (!cfg.appKey || !cfg.appSecret || !appId) return false
    const rows = await listMyOrders(openid)
    const deadline = Date.now() + RECOVER_BUDGET_MS
    for (let i = 0; i < rows.length && i < RECOVER_LIMIT; i++) {
      const no = rows[i].outTradeNo
      if (rows[i].status === 'delivered') {
        await grantPremium(openid, { outTradeNo: no })
        return true
      }
      if (Date.now() > deadline) {
        console.warn('recoverPaid budget out', i)
        return false
      }
      try {
        const order = await queryXpayOrder(cfg, appId, openid, no)
        if (order && paidStatus(order.status)) {
          await grantPremium(openid, {
            outTradeNo: no,
            extra: {
              wxOrderId: order.wx_order_id || '',
              paidFee: order.paid_fee || 0,
            },
          })
          return true
        }
      } catch (e) {
        console.warn('recover query', no, e && e.message)
      }
    }
    return false
  } catch (e) {
    console.error('recoverPaid', e && e.message)
    return false
  }
}

async function prepare(openid, jsCode) {
  const cfg = payConfig()
  if (!cfg.offerId || !cfg.appKey) {
    return { ok: false, code: 'pay_config', msg: '请先在云函数 pay 配置 OfferID 与 AppKey' }
  }
  if (!cfg.appSecret) {
    return { ok: false, code: 'pay_config', msg: '请在 pay/secrets.js 填写小程序 AppSecret' }
  }
  if (!cfg.productId || !(cfg.goodsPrice >= 1)) {
    return { ok: false, code: 'pay_config', msg: '请配置道具 ID 与价格（分）' }
  }

  // 必须先建集合：recoverPaid 依赖 premium_orders，集合不存在时会被静默吞成空数组。
  await ensureOrders()

  const user = await getUser(openid)
  if (user && user.premium === true) {
    return { ok: true, premium: true, already: true }
  }

  const { APPID } = cloud.getWXContext()
  const appId = APPID || cfg.appId
  const recovered = await recoverPaid(openid, cfg, appId)
  if (recovered) {
    return { ok: true, premium: true, already: true }
  }

  const sessionKey = await sessionKeyOf(jsCode, appId, cfg.appSecret)

  // 幂等核心：如果已经存在一张未结算的订单，就复用它的 outTradeNo，
  // 绝不为了这次点击再生成一个可支付的单号。若这笔其实已经付过（只是查询没拿到），
  // 微信会因为订单号重复而拒绝，宁可报“这笔已在处理中”，也不能二次扣费。
  const resumable = await findResumableOrder(openid, cfg)
  let outTradeNo
  if (resumable) {
    outTradeNo = resumable.outTradeNo
  } else {
    outTradeNo = newTradeNo()
    await db.collection('premium_orders').add({
      data: {
        outTradeNo,
        _openid: openid,
        productId: cfg.productId,
        goodsPrice: cfg.goodsPrice,
        env: cfg.env,
        status: 'created',
        createdAt: db.serverDate(),
        deliveredAt: null,
      },
    })
  }

  const signData = buildSignData(cfg, outTradeNo, openid)
  const paySig = hmacHex(cfg.appKey, 'requestVirtualPayment&' + signData)
  const signature = hmacHex(sessionKey, signData)

  return {
    ok: true,
    premium: false,
    mode: 'short_series_goods',
    signData,
    paySig,
    signature,
    outTradeNo,
    goodsPrice: cfg.goodsPrice,
    reused: !!resumable,
  }
}

async function confirm(openid, outTradeNo) {
  try {
    const user = await getUser(openid)
    if (user && user.premium === true) {
      return { ok: true, premium: true }
    }
    const no = String(outTradeNo || '').trim()
    if (!no) return { ok: true, premium: false }

    let order = null
    try {
      const r = await db.collection('premium_orders').where({ outTradeNo: no, _openid: openid }).limit(1).get()
      order = r.data && r.data[0]
    } catch (e) {
      order = null
    }
    if (order && order.status === 'delivered') {
      await grantPremium(openid, { outTradeNo: no })
      return { ok: true, premium: true }
    }

    const cfg = payConfig()
    const { APPID } = cloud.getWXContext()
    const appId = APPID || cfg.appId
    if (cfg.appKey && cfg.appSecret && appId && no) {
      try {
        const remote = await queryXpayOrder(cfg, appId, openid, no)
        if (remote && paidStatus(remote.status)) {
          await grantPremium(openid, {
            outTradeNo: no,
            extra: {
              wxOrderId: remote.wx_order_id || '',
              paidFee: remote.paid_fee || 0,
            },
          })
          return { ok: true, premium: true }
        }
      } catch (e) {
        console.warn('confirm query', e && e.message)
      }
    }
    return { ok: true, premium: false }
  } catch (e) {
    console.error('confirm', e && e.message)
    return { ok: true, premium: false, msg: (e && e.message) || '' }
  }
}

// ===== 事后补发货扫描 =====
// 背景：历史上 created 的订单如果当时没收到发货（推送未接、轮询窗口错过），
// users.premium 就一直是 false，用户会被要求再次付费。这里把那些单重新问一遍微信。
// 只能由带 repairKey 的调用触发（scripts/repair-premium.js），普通小程序调用拿不到。

function repairKey() {
  let s = {}
  try {
    s = require('./secrets')
  } catch (e) {
    s = {}
  }
  return String(process.env.XPAY_REPAIR_KEY || s.repairKey || '').trim()
}

async function repair(event) {
  const input = event || {}
  const key = repairKey()
  if (!key) {
    return { ok: false, msg: '未配置 repairKey（环境变量 XPAY_REPAIR_KEY 或 pay/secrets.js 的 repairKey），已拒绝执行' }
  }
  if (String(input.key || '') !== key) {
    return { ok: false, msg: 'repair key 不正确' }
  }

  const cfg = payConfig()
  const { APPID } = cloud.getWXContext()
  const appId = APPID || cfg.appId
  if (!cfg.appKey || !cfg.appSecret || !appId) {
    return { ok: false, msg: '缺少 appKey / appSecret / appId，无法查询微信订单' }
  }

  const dryRun = input.dryRun !== false
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 50))
  const skip = Math.max(0, Number(input.skip) || 0)
  const budget = Date.now() + 45000

  const r = await db
    .collection('premium_orders')
    .where({ status: 'created' })
    .orderBy('_id', 'asc')
    .skip(skip)
    .limit(limit)
    .get()

  const rows = r.data || []
  const report = {
    scanned: rows.length,
    paid: 0,
    granted: 0,
    alreadyPremium: 0,
    unpaid: 0,
    queryFailed: 0,
    noOpenid: 0,
    grantedOrders: [],
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const no = String(row.outTradeNo || '')
    const openid = String(row._openid || '')
    if (Date.now() > budget) {
      report.stopped = 'budget'
      break
    }
    if (!no || !openid) {
      report.noOpenid += 1
      continue
    }

    let remote = null
    try {
      remote = await queryXpayOrder(cfg, appId, openid, no)
    } catch (e) {
      report.queryFailed += 1
      continue
    }
    if (!remote) {
      report.queryFailed += 1
      continue
    }
    if (!paidStatus(remote.status)) {
      report.unpaid += 1
      continue
    }

    report.paid += 1
    const user = await getUser(openid)
    if (user && user.premium === true) {
      // 权益已经有了，只把订单状态补齐，避免它永远停在 created
      report.alreadyPremium += 1
      if (!dryRun) await markOrderDelivered(no, {})
      continue
    }
    report.grantedOrders.push(no)
    if (!dryRun) {
      await grantPremium(openid, {
        outTradeNo: no,
        extra: {
          wxOrderId: remote.wx_order_id || '',
          paidFee: remote.paid_fee || 0,
          repairedAt: db.serverDate(),
          repairedStatus: remote.status,
        },
      })
    }
  }

  report.granted = dryRun ? 0 : report.grantedOrders.length
  const nextSkip = rows.length === limit ? skip + rows.length : null

  return {
    ok: true,
    dryRun,
    limit,
    skip,
    nextSkip,
    done: nextSkip === null,
    report,
  }
}

exports.main = async (event) => {
  try {
    const action = (event && event.action) || 'prepare'
    // 补发货扫描走 HTTP 调用，拿不到 OPENID，必须在 OPENID 校验之前处理
    if (action === 'repair') return await repair(event)
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) return { ok: false, msg: '未获取到 openid' }
    if (action === 'prepare') return await prepare(OPENID, event && event.code)
    if (action === 'confirm') return await confirm(OPENID, event && event.outTradeNo)
    return { ok: false, msg: '未知操作' }
  } catch (e) {
    console.error('pay main', e)
    return { ok: false, msg: (e && e.message) || '支付准备失败' }
  }
}
