// 云开发数据访问层（所有读写都经由云函数，避免依赖集合权限配置）
import { isPremiumAmbience, parseAmbience } from './audioCatalog'
import { isPremiumTheme, parseTheme, ThemeId } from './theme'
import { mockEnabled, mockCallFunction } from './devMock'

export interface WishHit {
  date: string
  count: number
}

export type WishStatus = 'ongoing' | 'completed' | 'fulfilled'

/** 专注来源：亲手敲 / 自动敲 / 燃香折算 */
export type KnockSource = 'hand' | 'auto' | 'incense'
export type BySource = Partial<Record<KnockSource, number>>

export interface Wish {
  _id: string
  name: string
  goal: number
  current: number
  deadline: string | null
  status: WishStatus
  createdAt: number | Date
  hitLog: WishHit[]
  completedDate?: string
  fulfilledDate?: string
  hasSurprise?: boolean
  thumbUrl?: string
  /** 按来源累计；早于此功能的心愿没有，或只覆盖一部分 current */
  bySource?: BySource
  /** 为这个心愿燃尽的香（炷） */
  incenseCount?: number
}

export type AmbienceId = import('./audioCatalog').AmbienceId

export interface UserSettings {
  soundOn: boolean
  vibrateOn: boolean
  autoMode: boolean
  ambience: AmbienceId
  theme: ThemeId
}

export interface UserRecord {
  _id?: string
  nickname: string
  totalMerit: number
  /** 一次开启后为 true。只应由支付结果写入，不进 settings */
  premium?: boolean
  createdAt?: number | Date
  lastHitDate?: string | null
  settings?: UserSettings
}

export interface HomePayload {
  user: UserRecord
  activeWish: Wish | null
  completedWish: Wish | null
  streak: number
  todayCount: number
  /** 云端此刻的毫秒时间，用来校正本机时钟 */
  serverNow?: number
}

export interface ProfilePayload {
  user: UserRecord
  wishes: Wish[]
  map: Record<string, number>
  streak: number
  todayCount: number
}

export function settingsOf(u?: UserRecord | null): UserSettings {
  const d: UserSettings = { soundOn: true, vibrateOn: true, autoMode: false, ambience: 'off', theme: 'dawn' }
  const s: any = (u && u.settings) || {}
  let ambience = parseAmbience(s.ambience)
  let theme = parseTheme(s.theme)
  if (!u || u.premium !== true) {
    if (isPremiumAmbience(ambience)) ambience = 'off'
    if (isPremiumTheme(theme)) theme = 'dawn'
  }
  return {
    soundOn: typeof s.soundOn === 'boolean' ? s.soundOn : d.soundOn,
    vibrateOn: typeof s.vibrateOn === 'boolean' ? s.vibrateOn : d.vibrateOn,
    autoMode: typeof s.autoMode === 'boolean' ? s.autoMode : d.autoMode,
    ambience,
    theme,
  }
}

/** 上次从云端拿到的用户设置（登录、香案、静心页都会刷新）；没有就是默认值 */
export function cachedSettings(): UserSettings {
  const app = getApp<IAppOption>()
  return settingsOf(app && app.globalData ? app.globalData.user : null)
}

/** 记下云端最新的用户，别的页面读设置时用 */
export function rememberUser(u: UserRecord | null | undefined) {
  if (!u) return
  const app = getApp<IAppOption>()
  if (app && app.globalData) app.globalData.user = u
}

type CloudResult<T> = { ok: boolean; msg?: string; code?: string } & T

function callCloud<T>(name: string, data: Record<string, any> = {}): Promise<CloudResult<T>> {
  // 开发版可切到本地模拟，见 utils/devMock.ts
  const call: Promise<{ result: any }> = mockEnabled()
    ? mockCallFunction(name, data)
    : (wx.cloud.callFunction({ name, data }) as Promise<any>)
  return call
    .then((res) => {
      const r = res.result as CloudResult<T>
      if (!r || r.ok === false) {
        const err: any = new Error((r && r.msg) || '操作失败')
        if (r && r.code) err.code = r.code
        throw err
      }
      return r
    })
    .catch((e: any) => {
      if (e && e.code && e.message && e.message !== 'cloud.callFunction:ok') throw e
      const raw = String((e && (e.errMsg || e.message)) || '')
      let msg = raw
        .replace(/^cloud\.callFunction:fail\s*/i, '')
        .replace(/^Error:\s*/i, '')
        .trim()
      if (!msg || msg === 'cloud.callFunction:ok') msg = '网络异常，请稍后再试'
      if (/timeout|超时/i.test(msg)) msg = '云函数超时，请稍后重试'
      const err: any = new Error(msg.slice(0, 40))
      if (e && e.code) err.code = e.code
      throw err
    })
}

export function loginUser(): Promise<{ user: UserRecord }> {
  return callCloud('login')
}

export function fetchHome(): Promise<HomePayload> {
  return callCloud<HomePayload>('fetch', { action: 'home', date: todayStrLocal() })
}

export function fetchWishes(): Promise<{ user: UserRecord; wishes: Wish[] }> {
  return callCloud('fetch', { action: 'wishes' })
}

export function fetchWishDetail(wishId: string): Promise<{ wish: Wish }> {
  return callCloud('fetch', { action: 'detail', wishId })
}

export function fetchProfile(): Promise<ProfilePayload> {
  return callCloud<ProfilePayload>('fetch', { action: 'profile', date: todayStrLocal() })
}

export interface HitResp {
  totalMerit: number
  todayCount: number
  wish: Wish | null
}

/**
 * batchId：这批敲击的号。网络超时后重传同一个号，云端已记过就只回当前数，不会记两遍。
 * date：这批敲下的那天，重传跨了零点也记在原来那天
 */
export function hitKnock(
  wishId: string | null,
  by: { hand: number; auto: number },
  batchId = '',
  date = ''
): Promise<HitResp> {
  return callCloud<HitResp>('hit', {
    wishId: wishId || '',
    n: by.hand + by.auto,
    by,
    batchId,
    date: date || todayStrLocal(),
  })
}

export function createWish(name: string, goal: number, deadline: string | null): Promise<{ wishId: string }> {
  return callCloud('wish', { action: 'create', name, goal, deadline })
}

export function updateWish(wishId: string, name: string, goal: number, deadline: string | null): Promise<{ wishId: string }> {
  return callCloud('wish', { action: 'update', wishId, name, goal, deadline })
}

export function fulfillWish(wishId: string): Promise<{ wish: Wish }> {
  return callCloud('wish', { action: 'fulfill', wishId, date: todayStrLocal() })
}

/** localPath 只在本地模拟模式下出现，指向包内的占位壁纸 */
export function fetchPaperOrigin(
  wishId: string
): Promise<{ originUrl: string; originFileId?: string; localPath?: string }> {
  return callCloud('wish', { action: 'paperOrigin', wishId })
}

export function removeWish(wishId: string): Promise<void> {
  return callCloud('wish', { action: 'remove', wishId }).then(() => undefined)
}

export function updateSettings(patch: Partial<UserSettings>): Promise<{ settings: UserSettings }> {
  return callCloud('user', { settings: patch })
}

// 普通微信支付（商户平台 JSAPI）：参数由服务端签好名后下发，前端直接调 wx.requestPayment
export interface PremiumPayParams {
  premium: boolean
  already?: boolean
  outTradeNo?: string
  goodsPrice?: number
  timeStamp?: string
  nonceStr?: string
  package?: string
  signType?: 'RSA'
  paySign?: string
}

export function preparePremiumPay(): Promise<PremiumPayParams> {
  return callCloud<PremiumPayParams>('wxpay', { action: 'prepay' })
}

export function confirmPremiumPay(outTradeNo: string): Promise<{ premium: boolean }> {
  return callCloud('wxpay', { action: 'query', outTradeNo })
}

// 退款复核：商户平台退款后，微信侧订单会变成 REFUND，这里确认是否要收回权益
export function verifyPremium(): Promise<{ premium: boolean; refunded: boolean }> {
  return callCloud('wxpay', { action: 'verify' })
}

/** 静心包价格（分），只读配置，不下单 */
export function fetchPremiumPrice(): Promise<{ price: number }> {
  return callCloud('wxpay', { action: 'price' })
}

export function normalizeChannelScene(raw: string): string {
  let s = String(raw || '').trim()
  try {
    s = decodeURIComponent(s)
  } catch (e) {
    // keep
  }
  if (s.indexOf('ch_') === 0) return s
  return ''
}

export function bindChannelByScene(scene: string): Promise<{ bound: boolean; channelId?: string; reason?: string }> {
  const s = normalizeChannelScene(scene) || String(scene || '').trim()
  if (!s) return Promise.resolve({ bound: false, reason: 'empty' })
  return callCloud('bindChannel', { scene: s })
}

export function checkChannelAuth(): Promise<{ isChannel: boolean; channelId?: string; role?: string }> {
  return callCloud('checkChannelAuth')
}

export function miniEnvVersion(): 'trial' | 'release' {
  try {
    const v = wx.getAccountInfoSync().miniProgram.envVersion
    if (v === 'release') return 'release'
  } catch (e) {
    // keep
  }
  return 'trial'
}

export function activateChannel(activateCode: string): Promise<{ channelId: string; already?: boolean }> {
  return callCloud('activateChannel', { action: 'activate', activateCode })
}

export function previewActivate(activateCode: string): Promise<{
  name: string
  activateCode: string
  fileID: string
  pending: boolean
}> {
  return callCloud('activateChannel', { action: 'preview', activateCode })
}

export function applyChannel(name: string, contact: string, phone: string): Promise<{ phase: string }> {
  return callCloud('activateChannel', {
    action: 'apply',
    name,
    contact: contact || '',
    phone,
  })
}

export function applyChannelUnbind(): Promise<{ phase: string }> {
  return callCloud('activateChannel', { action: 'applyUnbind' })
}

/** 用户按 openid 自助改手机号：只能改自己名下的申请/渠道，无需审核 */
export function updateChannelPhone(phone: string): Promise<{ phone: string }> {
  return callCloud('activateChannel', { action: 'updatePhone', phone })
}

export interface PartnerAppRow {
  _id: string
  type: 'bind' | 'unbind'
  status: string
  name: string
  /** 申请时填写的手机号 */
  phone?: string
  wechatId: string
  /** 授权后对应渠道的 id，用于查看该渠道的历史数据 */
  channelId?: string
  createdAt: number
  handledAt: number
  /** 授权后对应渠道的当前状态：active=绑定中 / unbound=已解绑 */
  channelStatus?: string
}

export interface PartnerTenure {
  channelId: string
  name: string
  status: 'active' | 'unbound'
  wechatId: string
  boundAt: number
  unboundAt: number
}

export interface PartnerHub {
  isChannel: boolean
  channelId: string
  name: string
  /** 当前生效的手机号：已激活渠道 > 待激活渠道 > 待审申请 */
  phone?: string
  canApplyBind: boolean
  canApplyUnbind: boolean
  pendingBind: boolean
  pendingUnbind: boolean
  needActivate?: boolean
  activateName?: string
  activateCode?: string
  activateFileID?: string
  activateExpireAt?: number
  activateExpired?: boolean
  tenures: PartnerTenure[]
  applications: PartnerAppRow[]
}

export function channelHub(): Promise<PartnerHub> {
  return callCloud<PartnerHub>('activateChannel', { action: 'hub' })
}

export function channelActivateStatus(): Promise<{
  phase: 'none' | 'applied' | 'authorized' | 'active'
  channelId?: string
  name?: string
  contact?: string
  activateCode?: string
  fileID?: string
}> {
  return callCloud('activateChannel', { action: 'status' })
}

export function generateChannelQR(channelId: string): Promise<{ fileID: string }> {
  return callCloud('generateChannelQR', { channelId, envVersion: miniEnvVersion() })
}

export function channelAdminCheck(): Promise<{
  isAdmin: boolean
  needsBootstrap: boolean
  configured?: boolean
  /** 调用者自己的 openid，用于填进 CHANNEL_ADMIN_OPENIDS */
  openid?: string
}> {
  return callCloud('channelAdmin', { action: 'check' })
}

/** 自助认领管理员：必须带云函数环境变量 CHANNEL_ADMIN_KEY 里配的口令，否则一律被拒 */
export function channelAdminBootstrap(key: string): Promise<{ isAdmin: boolean; bootstrapped?: boolean }> {
  return callCloud('channelAdmin', { action: 'bootstrap', key })
}

export interface AdminChannelRow {
  _id: string
  name: string
  contact: string
  mark: string
  status: string
  commissionRate: number
  bound: boolean
  authorized: boolean
  expireAt?: number
}

export interface AdminAppRow {
  _id: string
  type: 'bind' | 'unbind'
  name: string
  contact: string
  /** 申请人填写的结算联系手机号 */
  phone: string
  mark: string
  channelId: string
  createdAt: number
}

export function channelAdminList(): Promise<{ list: AdminChannelRow[] }> {
  return callCloud('channelAdmin', { action: 'list' })
}

export function channelAdminApps(): Promise<{
  apps: AdminAppRow[]
  bindApps: AdminAppRow[]
  unbindApps: AdminAppRow[]
}> {
  return callCloud('channelAdmin', { action: 'apps' })
}

export function channelAdminAuthorize(applicationId: string): Promise<{
  channelId: string
  name: string
  activateCode: string
  fileID: string
  expireAt: number
}> {
  return callCloud('channelAdmin', { action: 'authorize', applicationId, envVersion: miniEnvVersion() })
}

export function channelAdminQr(channelId: string): Promise<{
  activateCode: string
  fileID: string
  expireAt: number
}> {
  return callCloud('channelAdmin', { action: 'qr', channelId, envVersion: miniEnvVersion() })
}

export function channelAdminRefreshActivate(channelId: string): Promise<{
  activateCode: string
  fileID: string
  expireAt: number
  name: string
}> {
  return callCloud('channelAdmin', { action: 'refreshActivate', channelId, envVersion: miniEnvVersion() })
}

export function channelAdminReject(applicationId: string): Promise<void> {
  return callCloud('channelAdmin', { action: 'reject', applicationId }).then(() => undefined)
}

export function channelAdminUnbind(channelId: string): Promise<void> {
  return callCloud('channelAdmin', { action: 'unbind', channelId }).then(() => undefined)
}

export function channelAdminApproveUnbind(applicationId: string): Promise<void> {
  return callCloud('channelAdmin', { action: 'approveUnbind', applicationId }).then(() => undefined)
}

export function channelAdminWipe(): Promise<{ results: { name: string; removed: number }[] }> {
  return callCloud('channelAdmin', { action: 'wipe' })
}

/** 管理员结算看板：某自然月各渠道的新增用户、付费、佣金、结算状态 */
export interface AdminSettleRow {
  channelId: string
  name: string
  phone: string
  receiverOpenid: string
  rate: number
  userCount: number
  paidCount: number
  orderAmount: number
  commissionAmount: number
  refundedAmount: number
  status: 'settled' | 'unsettled'
  settledAt: number
}

export function channelAdminSettleBoard(month?: string): Promise<{
  month: string
  list: AdminSettleRow[]
}> {
  return callCloud('channelAdmin', { action: 'settleBoard', month: month || '' })
}

/** 标记某渠道某月已结算。只改状态，不触发转账 */
export function channelAdminSettle(
  channelId: string,
  month: string
): Promise<{ already: boolean; settlement: AdminSettleRow }> {
  return callCloud('channelAdmin', { action: 'settle', channelId, month })
}

export interface ChannelStats {
  /** 云函数失败时 ok 为 false 并带 msg，调用方需检查 */
  ok?: boolean
  msg?: string
  name: string
  status: string
  /** 选了月份就是当月新增，未选月份是累计总数 */
  userCount: number
  paidCount: number
  totalCommission: number
  pendingCommission: number
  /** 已被管理员标记结算的佣金合计，申请记录「查看」展开时显示 */
  settledCommission?: number
  /** 该月被退款冲销的佣金，用于在结算页提示差异 */
  refundedAmount?: number
  /** 该月每天新增推广用户数，key 为 YYYY-MM-DD */
  dailyNew?: Record<string, number>
  settlement?: {
    status: 'settled' | 'unsettled'
    settledAt: number
    commissionAmount: number
    refundedAmount: number
  } | null
  month?: string
  /** 佣金超过 1000 条时可能少算 */
  truncated?: boolean
  /** 推广用户超过 1000 人时，列表只显示最近 1000 人 */
  usersTruncated?: boolean
  /** 只用识别号（openid 后 8 位）区分用户；未绑定时回退为「未填写」 */
  users: {
    id: string
    wechatId: string
    boundAt: number
    paid: boolean
  }[]
}

export function getChannelStats(
  channelId: string,
  opt?: { wechatId?: string; month?: string }
): Promise<ChannelStats> {
  return callCloud<ChannelStats>('getChannelStats', {
    channelId,
    wechatId: (opt && opt.wechatId) || '',
    month: (opt && opt.month) || '',
  })
}

function todayStrLocal(): string {
  const d = new Date()
  const p = (x: number) => (x < 10 ? '0' + x : '' + x)
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
