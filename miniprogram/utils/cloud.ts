// 云开发数据访问层（所有读写都经由云函数，避免依赖集合权限配置）

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
}

export interface UserSettings {
  soundOn: boolean
  vibrateOn: boolean
  autoMode: boolean
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
  const d: UserSettings = { soundOn: true, vibrateOn: true, autoMode: false }
  const s: any = (u && u.settings) || {}
  return {
    soundOn: typeof s.soundOn === 'boolean' ? s.soundOn : d.soundOn,
    vibrateOn: typeof s.vibrateOn === 'boolean' ? s.vibrateOn : d.vibrateOn,
    autoMode: typeof s.autoMode === 'boolean' ? s.autoMode : d.autoMode,
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

export function removeWish(wishId: string): Promise<void> {
  return callCloud('wish', { action: 'remove', wishId }).then(() => undefined)
}

export function updateSettings(patch: Partial<UserSettings>): Promise<{ settings: UserSettings }> {
  return callCloud('user', { settings: patch })
}

function todayStrLocal(): string {
  const d = new Date()
  const p = (x: number) => (x < 10 ? '0' + x : '' + x)
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
