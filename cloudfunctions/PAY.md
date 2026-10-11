# 虚拟支付：一次开启

氛围 / 主题的一次性解锁走小程序虚拟支付（道具直购），不是普通 JSAPI。

## 你需要准备的

1. 公众平台已开通虚拟支付，拿到 **OfferID**、现网 **AppKey**。
2. 同一小程序的 **AppSecret**（开发管理 → 开发设置；签名用户态需要，云调用不支持 `auth.code2Session`）。
3. 在 **虚拟支付 → 道具管理** 新建道具并发布到现网：
   - 建议道具 ID：`premium_unlock`（须与下面 `productId` 一致）
   - 价格：后台填元，`secrets.js` 里填**分**（例如 6 元 → `600`）
   - **iOS / 苹果支付最低 1 元**（`goodsPrice >= 100`）。现在若是几分钱，安卓或可过，iPhone 会报 `INVALID_PLATFORM` / 参数错误
   - 开发者工具会报 `INVALID_PLATFORM`，请用**安卓真机**预览；iPhone 还须在虚拟支付里开通苹果支付并配置小程序简称
4. 云开发控制台配置消息推送（见下）。

## 配置密钥

```bash
cp cloudfunctions/pay/secrets.example.js cloudfunctions/pay/secrets.js
```

编辑 `secrets.js`：

```js
module.exports = {
  offerId: '你的OfferID',
  appKey: '你的现网AppKey',
  appSecret: '小程序AppSecret',
  productId: 'premium_unlock',
  goodsPrice: 600, // 分，必须与道具现网价格一致
  env: 0,          // 0 现网；沙箱才用 1，并换沙箱 AppKey
}
```

`secrets.js` 已加入 `.gitignore`，不要提交。

也可用云函数环境变量：`XPAY_OFFER_ID`、`XPAY_APP_KEY`、`XPAY_APP_SECRET`、`XPAY_PRODUCT_ID`、`XPAY_GOODS_PRICE`、`XPAY_ENV`。

## 部署云函数

上传并部署：

- `pay`（下单签名；用 AppSecret 调 jscode2session）
- `xpayNotify`（发货 / 退款推送）
- `user` / `fetch` / `login`（若尚未部署过 premium 相关改动）

首次部署后，在开发者工具对 `pay`、`xpayNotify` 右键「云端安装依赖」。

若曾报 `-604100 api not found`：那是旧版走了云调用 `auth.code2Session`。更新 `pay` 并填好 `appSecret` 后重新部署即可。

## 消息推送（必须）

发货不能只靠小程序 `success` 回调。

1. 云开发控制台 → **设置** → **其他设置** → **消息推送**
2. 推送模式选 **云函数**
3. 添加两条（或按后台实际项勾选）：
   - 消息类型 `event`，事件 `xpay_goods_deliver_notify` → 云函数 `xpayNotify`
   - 消息类型 `event`，事件 `xpay_refund_notify` → 云函数 `xpayNotify`
4. 可选：`xpay_subscribe_ios_refund_query_notify` → 同一云函数（已按「不建议退款」应答）

支付成功后，推送会把对应用户的 `users.premium` 写成 `true`。

## 自测

1. 真机预览（开发者工具里虚拟支付能力有限）。
2. 静心 → 点灰色的氛围或主题 → 确认金额 → 付款。
3. 云函数日志应出现 `xpayNotify`；数据库 `users.premium === true`，`premium_orders` 状态为 `delivered`。
4. 未配置推送时，前端会提示「支付成功，请稍后刷新」；配好推送后会自动变成「已开启」。

## 流程摘要

1. 小程序 `wx.login` → 云函数 `pay`（`prepare`）用 AppKey / session_key 签名  
2. `wx.requestVirtualPayment` 拉起支付  
3. 微信推送 `xpay_goods_deliver_notify` → `xpayNotify` 发货  
4. 小程序轮询 `pay`（`confirm`）直到 `premium` 为 true  
