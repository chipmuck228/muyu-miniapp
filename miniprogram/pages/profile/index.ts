// 静心
import {
  fetchProfile,
  updateSettings,
  preparePremiumPay,
  confirmPremiumPay,
  UserSettings,
  settingsOf,
  channelAdminCheck,
} from '../../utils/cloud'
import { AMBIENCE_OPTIONS, AmbienceId, isPremiumAmbience, parseAmbience } from '../../utils/audioCatalog'
import { isPremiumTheme, parseTheme, ThemeId, THEMES } from '../../utils/theme'
import { fmtInt, todayStr, offsetDate, weekdayMon0, fmtMD, concealTabBar } from '../../utils/util'

interface HeatCell {
  key: string
  date: string
  count: number
  level: number
  isToday: boolean
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

interface DressOption {
  id: string
  name: string
  locked: boolean
}

function dressList(list: { id: string; name: string; premium?: boolean }[], premium: boolean): DressOption[] {
  return list.map((item) => ({
    id: item.id,
    name: item.name,
    locked: !!item.premium && !premium,
  }))
}

function wxLoginCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (r) => {
        if (r && r.code) resolve(r.code)
        else reject(new Error('登录失败'))
      },
      fail: () => reject(new Error('登录失败')),
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function devicePlatform(): string {
  try {
    const anyWx: any = wx
    if (typeof anyWx.getDeviceInfo === 'function') {
      const d = anyWx.getDeviceInfo()
      if (d && d.platform) return String(d.platform).toLowerCase()
    }
  } catch {
    // ignore
  }
  try {
    return String((wx.getSystemInfoSync() as any).platform || '').toLowerCase()
  } catch {
    return ''
  }
}

function payUnsupportedReason(): string {
  const p = devicePlatform()
  if (p === 'devtools') {
    return '请用手机微信打开（开发者工具不支持虚拟支付）'
  }
  return ''
}

function payFailHint(errMsg: string, errCode?: number): string {
  const msg = String(errMsg || '')
  const p = devicePlatform()
  if (msg.indexOf('INVALID_PLATFORM') >= 0 || errCode === -15001) {
    if (p === 'ios') {
      return '当前 iPhone 未能拉起苹果支付，请确认微信≥8.0.68、系统≥iOS15、大陆 App Store 账号'
    }
    return '当前环境无法支付，请用手机微信打开'
  }
  return msg.replace(/^requestVirtualPayment:fail\s*/i, '') || '支付失败'
}

function requestVirtualPay(p: {
  mode: string
  signData: string
  paySig: string
  signature: string
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const blocked = payUnsupportedReason()
    if (blocked) {
      reject(new Error(blocked))
      return
    }
    const anyWx: any = wx
    if (typeof anyWx.requestVirtualPayment !== 'function') {
      reject(new Error('当前微信版本不支持虚拟支付'))
      return
    }
    anyWx.requestVirtualPayment({
      mode: p.mode,
      signData: p.signData,
      paySig: p.paySig,
      signature: p.signature,
      success: () => resolve(),
      fail: (e: any) => {
        const code = e && e.errCode
        const msg = String((e && (e.errMsg || e.message)) || '')
        if (code === -2 || code === 1 || msg.indexOf('cancel') >= 0 || msg.indexOf('取消') >= 0) {
          const err: any = new Error('已取消')
          err.code = 'cancel'
          reject(err)
          return
        }
        reject(new Error(payFailHint(msg, code)))
      },
    })
  })
}

function yuanText(fen: number): string {
  if (!(fen > 0)) return ''
  const y = fen / 100
  return Number.isInteger(y) ? String(y) : y.toFixed(2)
}

function levelOfCount(c: number): number {
  if (c <= 0) return 0
  if (c <= 2) return 1
  if (c <= 5) return 2
  if (c <= 9) return 3
  return 4
}

function buildHeat(map: Record<string, number>): HeatCell[][] {
  const today = todayStr()
  const wd = weekdayMon0(today)
  const monday = offsetDate(today, -wd)
  const start = offsetDate(monday, -28) // 5 周前周一
  const rows: HeatCell[][] = []
  for (let w = 0; w < 5; w++) {
    const row: HeatCell[] = []
    for (let c = 0; c < 7; c++) {
      const date = offsetDate(start, w * 7 + c)
      const count = map[date] || 0
      row.push({
        key: date,
        date,
        count,
        level: levelOfCount(count),
        isToday: date === today,
      })
    }
    rows.push(row)
  }
  return rows
}

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    totalText: '0',
    wishCount: 0,
    streak: 0,
    rate: 0,
    nickname: '',
    rows: [] as HeatCell[][],
    weekdayLabels: WEEKDAY_LABELS,
    selText: '',
    todayLabel: '',
    soundOn: true,
    vibrateOn: true,
    autoMode: false,
    ambience: 'off' as AmbienceId,
    ambienceOptions: dressList(AMBIENCE_OPTIONS, false),
    theme: 'dawn' as ThemeId,
    themeOptions: dressList(THEMES, false),
    premium: false,
    showAdmin: false,
  },

  _alive: false,
  _paying: false,

  onLoad() {
    const app = getApp<IAppOption>()
    this._alive = true
    this._paying = false
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    concealTabBar(this)
    this.load()
  },

  onUnload() {
    this._alive = false
  },

  async load() {
    try {
      const res = await fetchProfile()
      if (!this._alive) return
      const done = res.wishes.filter((w) => w.status === 'completed' || w.status === 'fulfilled').length
      const rate = res.wishes.length ? Math.round((done / res.wishes.length) * 100) : 0
      const today = todayStr()
      const rows = buildHeat(res.map || {})
      const todayCount = res.todayCount || 0
      const s = settingsOf(res.user)
      const premium = res.user.premium === true
      this.setData({
        loading: false,
        totalText: fmtInt(res.user.totalMerit || 0),
        wishCount: res.wishes.length,
        streak: res.streak,
        rate,
        nickname: res.user.nickname || '静心的人',
        rows,
        todayLabel: todayCount > 0 ? String(todayCount) : '',
        selText: todayCount > 0 ? today + '  ·  ' + todayCount : today,
        soundOn: s.soundOn,
        vibrateOn: s.vibrateOn,
        autoMode: s.autoMode,
        ambience: s.ambience,
        ambienceOptions: dressList(AMBIENCE_OPTIONS, premium),
        theme: s.theme,
        themeOptions: dressList(THEMES, premium),
        premium,
      })
      this.loadChannelFlags()
    } catch (e: any) {
      if (!this._alive) return
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },

  onPickCell(e: any) {
    const date = e.currentTarget.dataset.date
    const count = Number(e.currentTarget.dataset.count || 0)
    this.setData({
      selText: count > 0 ? fmtMD(date) + '  ·  ' + count : fmtMD(date),
    })
  },

  // ===== 设置 =====
  toggleSound() {
    this.saveSetting({ soundOn: !this.data.soundOn })
  },
  toggleVibrate() {
    this.saveSetting({ vibrateOn: !this.data.vibrateOn })
  },
  toggleAuto() {
    this.saveSetting({ autoMode: !this.data.autoMode })
  },
  onPickAmbience(e: any) {
    const ambience = parseAmbience(e.currentTarget.dataset.id)
    if (ambience === this.data.ambience) return
    if (isPremiumAmbience(ambience) && !this.data.premium) {
      this.askUnlock()
      return
    }
    this.saveSetting({ ambience })
  },
  onPickTheme(e: any) {
    const theme = parseTheme(e.currentTarget.dataset.id)
    if (theme === this.data.theme) return
    if (isPremiumTheme(theme) && !this.data.premium) {
      this.askUnlock()
      return
    }
    this.saveSetting({ theme })
  },
  askUnlock() {
    this.beginUnlock()
  },

  markPremium() {
    this.setData({
      premium: true,
      ambienceOptions: dressList(AMBIENCE_OPTIONS, true),
      themeOptions: dressList(THEMES, true),
    })
  },

  async waitDelivered(outTradeNo: string): Promise<boolean> {
    for (let i = 0; i < 10; i++) {
      if (!this._alive) return false
      const r = await confirmPremiumPay(outTradeNo)
      if (r.premium) return true
      await sleep(700)
    }
    return false
  },

  async beginUnlock() {
    if (this._paying) return
    this._paying = true
    wx.showLoading({ title: '准备中', mask: true })
    try {
      const code = await wxLoginCode()
      const prep = await preparePremiumPay(code)
      if (!this._alive) return
      if (prep.premium || prep.already) {
        wx.hideLoading()
        this.markPremium()
        wx.showToast({ title: '已开启', icon: 'none' })
        return
      }
      if (!prep.signData || !prep.paySig || !prep.signature || !prep.mode) {
        throw new Error('支付参数不完整')
      }
      const price = yuanText(prep.goodsPrice || 0)
      wx.hideLoading()
      if (price) {
        const go = await new Promise<boolean>((resolve) => {
          wx.showModal({
            title: '一次开启',
            content: '氛围与主题 · ¥' + price,
            confirmText: '支付',
            cancelText: '取消',
            confirmColor: '#e0b577',
            success: (r) => resolve(!!r.confirm),
            fail: () => resolve(false),
          })
        })
        if (!go) return
      }
      await requestVirtualPay({
        mode: prep.mode,
        signData: prep.signData,
        paySig: prep.paySig,
        signature: prep.signature,
      })
      if (!this._alive) return
      wx.showLoading({ title: '发放中', mask: true })
      const ok = await this.waitDelivered(prep.outTradeNo || '')
      wx.hideLoading()
      if (!this._alive) return
      if (ok) {
        this.markPremium()
        wx.showToast({ title: '已开启', icon: 'none' })
      } else {
        wx.showToast({ title: '支付成功，请稍后刷新', icon: 'none' })
      }
    } catch (e: any) {
      wx.hideLoading()
      if (!this._alive) return
      if (e && e.code === 'cancel') return
      wx.showToast({ title: (e && e.message) || '未能开启', icon: 'none' })
    } finally {
      this._paying = false
    }
  },
  saveSetting(patch: Partial<UserSettings>) {
    const prev = {
      soundOn: this.data.soundOn,
      vibrateOn: this.data.vibrateOn,
      autoMode: this.data.autoMode,
      ambience: this.data.ambience,
      theme: this.data.theme,
    }
    this.setData(patch)
    updateSettings(patch).catch((e: any) => {
      if (e && e.code === 'premium') {
        this.setData(prev)
        this.askUnlock()
        return
      }
      wx.showToast({ title: '保存失败', icon: 'none' })
      this.load()
    })
  },

  async loadChannelFlags() {
    try {
      const admin = await channelAdminCheck().catch(() => ({
        isAdmin: false,
        needsBootstrap: false,
      }))
      if (!this._alive) return
      this.setData({
        showAdmin: !!(admin.isAdmin || admin.needsBootstrap),
      })
    } catch (e) {
      // 入口保持隐藏
    }
  },

  async openPartner() {
    wx.navigateTo({ url: '/pages/partner/index' })
  },

  openAdmin() {
    wx.navigateTo({ url: '/pages/partner/admin' })
  },
})
