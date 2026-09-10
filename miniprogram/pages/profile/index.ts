// 我的修行
import { fetchProfile, updateSettings, UserSettings } from '../../utils/cloud'
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
      this.setData({
        loading: false,
        totalText: fmtInt(res.user.totalMerit || 0),
        wishCount: res.wishes.length,
        streak: res.streak,
        rate,
        nickname: res.user.nickname || '禅心行者',
        rows,
        todayLabel: todayCount > 0 ? String(todayCount) : '',
        selText: todayCount > 0 ? today + '  ·  ' + todayCount : today,
        soundOn: !!(res.user.settings && res.user.settings.soundOn),
        vibrateOn: !!(res.user.settings && res.user.settings.vibrateOn),
        autoMode: !!(res.user.settings && res.user.settings.autoMode),
      })
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
  toggleSound(e: any) {
    this.saveSetting('soundOn', !!e.detail.value)
  },
  toggleVibrate(e: any) {
    this.saveSetting('vibrateOn', !!e.detail.value)
  },
  toggleAuto(e: any) {
    this.saveSetting('autoMode', !!e.detail.value)
  },
  saveSetting(key: keyof UserSettings, v: boolean) {
    const patch = { [key]: v } as Partial<UserSettings>
    const data: any = {}
    data[key] = v
    this.setData(data)
    updateSettings(patch).catch(() => {
      wx.showToast({ title: '保存失败', icon: 'none' })
      this.load()
    })
  },
})
