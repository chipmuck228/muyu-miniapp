// 静心
import {
  fetchProfile,
  updateSettings,
  confirmPremiumPay,
  verifyPremium,
  UserSettings,
  settingsOf,
  channelAdminCheck,
} from '../../utils/cloud'
import { AMBIENCE_OPTIONS, AmbienceId, isPremiumAmbience, parseAmbience } from '../../utils/audioCatalog'
import { isPremiumTheme, parseTheme, ThemeId, THEMES } from '../../utils/theme'
import { buyPremium, isPaying, readPending, writePending, sleep } from '../../utils/premium'
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
  /** 主题色块的背景样式；氛围没有 */
  swatch: string
}

function dressList(
  list: { id: string; name: string; premium?: boolean; swatch?: [string, string] }[],
  premium: boolean
): DressOption[] {
  return list.map((item) => ({
    id: item.id,
    name: item.name,
    locked: !!item.premium && !premium,
    swatch: item.swatch ? 'background: linear-gradient(180deg, ' + item.swatch[0] + ' 0%, ' + item.swatch[1] + ' 100%);' : '',
  }))
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
    ambience: 'off' as AmbienceId,
    ambienceOptions: dressList(AMBIENCE_OPTIONS, false),
    theme: 'dawn' as ThemeId,
    themeOptions: dressList(THEMES, false),
    premium: false,
    showAdmin: false,
  },

  _alive: false,
  _resuming: false,
  _verified: false,

  onLoad() {
    const app = getApp<IAppOption>()
    this._alive = true
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    concealTabBar(this)
    this.load()
    this.resumePending()
    this.verifyRefund()
  },

  onUnload() {
    this._alive = false
  },

  // 上一笔付款没能当场确认发货时的续查。每次回到本页都继续追，直到开启或过期，
  // 避免用户在发货到达前被要求再次付费。
  async resumePending() {
    if (isPaying() || this._resuming) return
    const no = readPending()
    if (!no) return
    this._resuming = true
    try {
      for (let i = 0; i < 12; i++) {
        if (!this._alive || this.data.premium) return
        const r = await confirmPremiumPay(no)
        if (r.premium) {
          writePending('')
          this.markPremium()
          wx.showToast({ title: '静心包已开启', icon: 'none' })
          return
        }
        await sleep(i < 6 ? 1000 : 2000)
      }
    } catch (e) {
      // 保留挂起状态，下次进入页面再试
    } finally {
      this._resuming = false
    }
  },

  // 退款复核：在商户平台给用户退款后，微信侧订单会变成 REFUND。
  // 我们没接异步回调，所以每次进本页主动问一次微信；确认已退款就收回权益。
  // 每次页面实例只查一次，避免切 tab 时反复请求。
  async verifyRefund() {
    if (this._verified || isPaying() || this._resuming) return
    this._verified = true
    try {
      if (!this.data.premium) return
      const r = await verifyPremium()
      if (!this._alive) return
      if (r.refunded) {
        writePending('')
        wx.showToast({ title: '已退款，高级功能已关闭', icon: 'none' })
        this.load()
      }
    } catch (e) {
      // 复核失败不收回权益：网络抖动不应误伤付费用户
    }
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
      if (premium) writePending('')
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

  async beginUnlock() {
    const r = await buyPremium(() => this._alive)
    if (!this._alive) return
    if (r === 'opened') {
      this.markPremium()
      wx.showToast({ title: '静心包已开启', icon: 'none' })
    } else if (r === 'pending') {
      // 不要提示“刷新”：用户在回到本页时会由 resumePending 自动续查
      wx.showToast({ title: '付款已收到，正在开启', icon: 'none' })
    }
  },
  saveSetting(patch: Partial<UserSettings>) {
    const prev = {
      soundOn: this.data.soundOn,
      vibrateOn: this.data.vibrateOn,
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
