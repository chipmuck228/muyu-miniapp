const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')
const { payConfig } = require('./config')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PRODUCT_TAG = 'premium'

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

function hmacHex(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest('hex')
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

// auth.code2Session 不在云调用白名单，会报 -604100；改走 jscode2session HTTP。
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
    await db
      .collection('premium_orders')
      .where({ outTradeNo: orderPatch.outTradeNo })
      .limit(1)
      .update({
        data: Object.assign(
          {
            status: 'delivered',
            deliveredAt: db.serverDate(),
          },
          orderPatch.extra || {}
        ),
      })
      .catch(() => null)
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

  const user = await getUser(openid)
  if (user && user.premium === true) {
    return { ok: true, premium: true, already: true }
  }

  const { APPID } = cloud.getWXContext()
  const sessionKey = await sessionKeyOf(jsCode, APPID || cfg.appId, cfg.appSecret)
  await ensureOrders()
  const outTradeNo = newTradeNo()
  const signData = buildSignData(cfg, outTradeNo, openid)
  const paySig = hmacHex(cfg.appKey, 'requestVirtualPayment&' + signData)
  const signature = hmacHex(sessionKey, signData)

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

  return {
    ok: true,
    premium: false,
    mode: 'short_series_goods',
    signData,
    paySig,
    signature,
    outTradeNo,
    goodsPrice: cfg.goodsPrice,
  }
}

async function confirm(openid, outTradeNo) {
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
  return { ok: true, premium: !!(user && user.premium === true) }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, msg: '未获取到 openid' }
  const action = (event && event.action) || 'prepare'
  try {
    if (action === 'prepare') return await prepare(OPENID, event && event.code)
    if (action === 'confirm') return await confirm(OPENID, event && event.outTradeNo)
    return { ok: false, msg: '未知操作' }
  } catch (e) {
    console.error('pay', action, e)
    return { ok: false, msg: (e && e.message) || '支付准备失败' }
  }
}