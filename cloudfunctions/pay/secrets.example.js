// 复制为 secrets.js 后填写。secrets.js 不要提交、不要打进小程序包。
// 道具须在「虚拟支付 → 道具管理」发布到现网，价格（分）与 goodsPrice 一致。
// AppSecret：公众平台 → 开发管理 → 开发设置 → AppSecret（生成/重置后复制）

module.exports = {
  offerId: '',
  appKey: '',
  appSecret: '',
  appId: '',
  // 必须与「虚拟支付 → 道具管理」发布到现网的道具 ID 完全一致，区分大小写
  productId: 'Premium',
  // 单位：分。安卓可低于 1 元；iOS / 苹果支付要求不少于 100（1 元）
  goodsPrice: 600,
  env: 0,
  // 补发货扫描脚本的调用密钥，自行生成一串随机字符串。
  // 不填则 scripts/repair-premium.js 会被云函数拒绝。切勿外泄。
  repairKey: '',
}
