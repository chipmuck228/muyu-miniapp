# 渠道分发

读写都走云函数，集合权限可设为「仅创建者可读写」或不对客户端开放。

## 日常怎么邀渠道商

激活码绑定的是**指定微信**，不是谁扫都能激活。

1. 渠道商用自己的微信打开小程序 → 静心 → **渠道合作**，填写名称（管理员用来辨认是谁）并提交申请。
2. 管理员打开 **渠道管理**，在「待授权」里认出这个人，点 **授权**。系统把激活码绑到该微信。
3. 渠道商回到激活页，会看到只属于自己的激活码二维码，点「激活」（或扫自己的码）。别人扫会提示未授权。
4. 激活后自动生成 **推广码**（用户扫这个才会归因到该渠道）。

换微信：新微信先提交申请，管理员在对应渠道点「换绑」并选中该申请。原微信失效，用户与佣金仍挂同一 `channelId`。

一个微信只能激活一个渠道。

`generateChannelQR` / `channelAdmin` 需要开通 `wxacode.getUnlimited`。体验版扫体验版码。

## 集合

### channel_applications（渠道申请）

- 字段：`_openid`, `name`, `contact`, `status`（pending | authorized | rejected）, `channelId`, `createdAt`, `handledAt`
- 索引：`_openid`

### channels（渠道商）

一条记录对应一个渠道，最多绑定一个微信。

- 字段：`name`, `contact`, `activateCode`, `activateQrFileID`, `commissionRate`（≤0.3）, `subMerchantId`, `status`（pending | active | disabled）, `authorizedOpenid`（允许激活的微信）, `_openid`（已激活的微信，未激活为空）, `activatedAt`, `createdAt`
- 索引：`activateCode` 唯一；`authorizedOpenid`；`_openid`

扫推广码 scene 为 `ch_{channelId}`，落地页 `pages/home/index`。

扫激活码 scene 为 `ac_{activateCode}`，落地页 `pages/partner/activate`。云函数会校验当前微信是否等于 `authorizedOpenid`。

### channel_admins（小程序渠道管理员）

- 字段：`_openid`, `createdAt`
- 集合为空时，第一个打开「渠道管理」的微信会写入一条。

### channel_users / channel_commissions

与原先相同。`createOrder` 目前只写 pending 佣金，不调用微信支付分账。

## 一次性部署

上传并部署：`channelAdmin`、`activateChannel`、`checkChannelAuth`、`generateChannelQR`、`getChannelStats`、`initChannelDb`。

`initChannelDb` 测试运行一次，补建 `channel_applications` 等空集合。
