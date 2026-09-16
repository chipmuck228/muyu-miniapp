// 云开发数据访问层（所有读写都经由云函数，避免依赖集合权限配置）
import { parseAmbience } from './audioCatalog'

export interface WishHit {
  date: string
  count: number
}

export type WishStatus = 'ongoing' | 'completed' | 'fulfilled'

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
}

export type AmbienceId = import('./audioCatalog').AmbienceId

export interface UserSettings {
  soundOn: boolean
  vibrateOn: boolean
  autoMode: boolean
  ambience: AmbienceId
}

export interface UserRecord {
  _id?: string
  nickname: string
  totalMerit: number
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
}

export interface ProfilePayload {
  user: UserRecord
  wishes: Wish[]
  map: Record<string, number>
  streak: number
  todayCount: number
}

export function settingsOf(u?: UserRecord | null): UserSettings {
  const d: UserSettings = { soundOn: true, vibrateOn: true, autoMode: false, ambience: 'off' }
  const s: any = (u && u.settings) || {}
  return {
    soundOn: typeof s.soundOn === 'boolean' ? s.soundOn : d.soundOn,
    vibrateOn: typeof s.vibrateOn === 'boolean' ? s.vibrateOn : d.vibrateOn,
    autoMode: typeof s.autoMode === 'boolean' ? s.autoMode : d.autoMode,
    ambience: parseAmbience(s.ambience),
  }
}

type CloudResult<T> = { ok: boolean; msg?: string } & T

function callCloud<T>(name: string, data: Record<string, any> = {}): Promise<CloudResult<T>> {
  return wx.cloud
    .callFunction({ name, data })
    .then((res) => {
      const r = res.result as CloudResult<T>
      if (!r || r.ok === false) {
        throw new Error((r && r.msg) || '操作失败')
      }
      return r
    })
    .catch((e) => {
      throw new Error((e && e.message) || '网络异常，请稍后再试')
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

export function hitKnock(wishId: string | null, n: number): Promise<HitResp> {
  return callCloud<HitResp>('hit', { wishId: wishId || '', n, date: todayStrLocal() })
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

export function fetchPaperOrigin(wishId: string): Promise<{ originUrl: string; originFileId?: string }> {
  return callCloud('wish', { action: 'paperOrigin', wishId })
}

export function removeWish(wishId: string): Promise<void> {
  return callCloud('wish', { action: 'remove', wishId }).then(() => undefined)
}

export function updateSettings(patch: Partial<UserSettings>): Promise<{ settings: UserSettings }> {
  return callCloud('user', { settings: patch })
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

export function applyChannel(name: string, contact?: string): Promise<{ phase: string }> {
  return callCloud('activateChannel', {
    action: 'apply',
    name,
    contact: contact || '',
  })
}

export function applyChannelUnbind(): Promise<{ phase: string }> {
  return callCloud('activateChannel', { action: 'applyUnbind' })
}

export interface PartnerAppRow {
  _id: string
  type: 'bind' | 'unbind'
  status: string
  name: string
  wechatId: string
  createdAt: number
  handledAt: number
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

export function channelAdminCheck(): Promise<{ isAdmin: boolean; needsBootstrap: boolean }> {
  return callCloud('channelAdmin', { action: 'check' })
}

export function channelAdminBootstrap(): Promise<{ isAdmin: boolean; bootstrapped?: boolean }> {
  return callCloud('channelAdmin', { action: 'bootstrap' })
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

export interface ChannelStats {
  name: string
  status: string
  userCount: number
  paidCount: number
  totalCommission: number
  pendingCommission: number
  users: { id: string; wechatId: string; boundAt: number; paid: boolean }[]
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
