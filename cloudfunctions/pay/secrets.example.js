// 复制为 secrets.js 后填写。secrets.js 不要提交、不要打进小程序包。
// 道具须在「虚拟支付 → 道具管理」发布到现网，价格（分）与 goodsPrice 一致。
// AppSecret：公众平台 → 开发管理 → 开发设置 → AppSecret（生成/重置后复制）

module.exports = {
  offerId: '',
  appKey: '',
  appSecret: '',
  productId: 'premium_unlock',
  // 单位：分。安卓可低于 1 元；iOS / 苹果支付要求不少于 100（1 元）
  goodsPrice: 600,
  env: 0,
}
