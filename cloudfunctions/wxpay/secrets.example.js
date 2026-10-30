// 复制为 secrets.js 并填写真实值。secrets.js 已在 .gitignore 中，不要提交。
module.exports = {
  // 小程序 AppID（公众平台 → 开发管理 → 开发设置）
  appid: '',
  // 商户号（微信支付商户平台 → 账户中心 → 商户信息）
  mchid: '',
  // 商户 API 证书序列号（商户平台 → 账户中心 → API安全 → API证书 → 证书序列号）
  serialNo: '',
  // 商户 API 证书私钥 apiclient_key.pem 的完整内容（含首尾行）
  // 可写成一行并用 \n 代替换行，也可以直接用模板字符串保留换行
  privateKey: '',
  // APIv3 密钥（商户平台 → 账户中心 → API安全 → 设置APIv3密钥）。本实现不验签回调，可不填
  apiV3Key: '',
  // 可选。支付结果通知地址，必须是公网 HTTPS。不填则靠主动查单确认
  notifyUrl: '',
  // 单位：分
  price: 600,
  // 商品描述，会展示在用户支付凭证上
  description: '静心包 · 定课、氛围与主题一次开启',
}
