// 静心
import {
  fetchProfile,
  updateSettings,
  UserSettings,
  settingsOf,
  channelAdminCheck,
} from '../../utils/cloud'
import { AMBIENCE_OPTIONS, AmbienceId, parseAmbience } from '../../utils/audioCatalog'
import { fmtInt, todayStr, offsetDate, weekdayMon0, fmtMD, concealTabBar } from '../../utils/util'

interface HeatCell {
  key: string
  date: string
  count: number
  level: number
  isToday: boolean
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

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
    ambienceOptions: AMBIENCE_OPTIONS,
    showAdmin: false,
  },

  _alive: false,

  onLoad() {
    const app = getApp<IAppOption>()
    this._alive = true
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
    this.saveSetting({ ambience })
  },
  saveSetting(patch: Partial<UserSettings>) {
    this.setData(patch)
    updateSettings(patch).catch(() => {
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
