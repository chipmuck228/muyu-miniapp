// 优先读同目录 secrets.js；也可用云函数环境变量覆盖。

function num(v, fallback) {
  const n = parseInt(v, 10)
  return isNaN(n) ? fallback : n
}

function loadSecrets() {
  try {
    return require('./secrets')
  } catch (e) {
    return {}
  }
}

function payConfig() {
  const s = loadSecrets()
  const offerId = String(process.env.XPAY_OFFER_ID || s.offerId || '').trim()
  const appKey = String(process.env.XPAY_APP_KEY || s.appKey || '').trim()
  const appSecret = String(process.env.XPAY_APP_SECRET || s.appSecret || '').trim()
  const appId = String(process.env.XPAY_APP_ID || s.appId || '').trim()
  // 道具 ID 必须与「虚拟支付 → 道具管理」里发布到现网的完全一致，且区分大小写。
  const productId = String(process.env.XPAY_PRODUCT_ID || s.productId || 'Premium').trim()
  const goodsPrice = num(process.env.XPAY_GOODS_PRICE != null ? process.env.XPAY_GOODS_PRICE : s.goodsPrice, 0)
  const env = num(process.env.XPAY_ENV != null ? process.env.XPAY_ENV : s.env, 0)
  return { offerId, appKey, appSecret, appId, productId, goodsPrice, env: env === 1 ? 1 : 0 }
}

module.exports = { payConfig }
