// 普通微信支付（商户平台 · JSAPI 小程序支付）配置
// 优先读同目录 secrets.js；也可用云函数环境变量覆盖。
// 注意：这里与 cloudfunctions/pay（虚拟支付/xpay）是两套完全不同的东西。

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

// 私钥常以 \n 转义形式粘贴进来，这里统一还原成真正的换行
function normPem(v) {
  return String(v || '')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .trim()
}

function wxpayConfig() {
  const s = loadSecrets()
  const appid = String(process.env.WXPAY_APPID || s.appid || '').trim()
  const mchid = String(process.env.WXPAY_MCHID || s.mchid || '').trim()
  const serialNo = String(process.env.WXPAY_SERIAL_NO || s.serialNo || '').trim()
  const privateKey = normPem(process.env.WXPAY_PRIVATE_KEY || s.privateKey)
  const apiV3Key = String(process.env.WXPAY_API_V3_KEY || s.apiV3Key || '').trim()
  // 可选。不配也能用：本实现靠主动查单确认结果，不依赖异步回调。
  const notifyUrl = String(process.env.WXPAY_NOTIFY_URL || s.notifyUrl || '').trim()
  // 单位：分
  const price = num(
    process.env.WXPAY_PRICE != null ? process.env.WXPAY_PRICE : s.price,
    num(process.env.XPAY_GOODS_PRICE, 0)
  )
  const description = String(
    process.env.WXPAY_DESC || s.description || '静心包 · 定课、氛围与主题一次开启'
  ).trim()

  // 分账。默认关闭，开启前必须确认商户平台已开通「分账」产品：
  // 开启后下单会带 settle_info.profit_sharing，该笔资金会被冻结，
  // 直到完成分账或主动解冻，否则一直挂账无法结算。
  const splitFlag = String(process.env.WXPAY_SPLIT || s.split || '0').trim().toLowerCase()
  const splitEnabled = splitFlag === '1' || splitFlag === 'true' || splitFlag === 'on'
  // 分账比例（0 ~ 0.3）。微信规定单笔订单最多分 30%，超出会被直接拒绝
  let splitRate = Number(
    process.env.WXPAY_SPLIT_RATE != null ? process.env.WXPAY_SPLIT_RATE : s.splitRate
  )
  if (isNaN(splitRate) || !(splitRate > 0)) splitRate = 0.2
  if (splitRate > 0.3) splitRate = 0.3
  // 管理类动作（添加接收方、解冻、查分账）的口令，留空则这些动作不可用
  const adminKey = String(process.env.WXPAY_ADMIN_KEY || s.adminKey || '').trim()

  return {
    appid,
    mchid,
    serialNo,
    privateKey,
    apiV3Key,
    notifyUrl,
    price,
    description,
    splitEnabled,
    splitRate,
    adminKey,
  }
}

function wxpayReady(cfg) {
  return !!(cfg && cfg.appid && cfg.mchid && cfg.serialNo && cfg.privateKey && cfg.price >= 1)
}

module.exports = { wxpayConfig, wxpayReady }
