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
import { buyPremium, isPaying, readPending, writePending, sleep, PACK_NAME } from '../../utils/premium'
import { fmtInt, todayStr, offsetDate, weekdayMon0, fmtMD, concealTabBar, weekdayCN } from '../../utils/util'
import { levelOf, LEVELS } from '../../utils/constants'
import { zenOfDay } from '../../utils/zen'
import { startAmbience, stopAmbience, fadeOutAmbience } from '../../utils/ambience'
import { vibrate } from '../../utils/knock'

interface HeatCell {
  key: string
  date: string
  /** 格子里写的日：每月 1 号写「11月」 */
  day: string
  count: number
  level: number
  isToday: boolean
  future: boolean
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const HEAT_WEEKS = 5
/** 选了氛围以后试听多久再淡出 */
const PREVIEW_MS = 3500

interface LadderRow {
  level: number
  title: string
  need: string
  reached: boolean
  cur: boolean
}

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

/** 深浅按这几周里最多的一天来分四档，几百下的日子也分得出层次 */
function levelOfCount(c: number, max: number): number {
  if (c <= 0) return 0
  return Math.max(1, Math.min(4, Math.ceil((c / Math.max(1, max)) * 4)))
}

function buildHeat(map: Record<string, number>): HeatCell[][] {
  const today = todayStr()
  const wd = weekdayMon0(today)
  const monday = offsetDate(today, -wd)
  const start = offsetDate(monday, -7 * (HEAT_WEEKS - 1))
  let max = 0
  for (let i = 0; i < HEAT_WEEKS * 7; i++) max = Math.max(max, map[offsetDate(start, i)] || 0)
  const rows: HeatCell[][] = []
  for (let w = 0; w < HEAT_WEEKS; w++) {
    const row: HeatCell[] = []
    for (let c = 0; c < 7; c++) {
      const date = offsetDate(start, w * 7 + c)
      const count = map[date] || 0
      const d = parseInt(date.slice(8, 10), 10)
      row.push({
        key: date,
        date,
        day: d === 1 ? parseInt(date.slice(5, 7), 10) + '月' : String(d),
        count,
        level: levelOfCount(count, max),
        isToday: date === today,
        future: date > today,
      })
    }
    rows.push(row)
  }
  return rows
}

function heatCaption(date: string, count: number): string {
  const head = (date === todayStr() ? '今日' : fmtMD(date)) + ' ' + weekdayCN(date)
  return count > 0 ? head + ' · 敲了 ' + fmtInt(count) + ' 下' : head + ' · 未敲'
}

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    totalText: '0',
    wishCount: 0,
    doneCount: 0,
    streak: 0,
    todayCount: 0,
    rate: 0,
    level: 1,
    levelTitle: '',
    levelPct: 0,
    levelNext: '',
    /** 点开称号卡，看九境都是什么 */
    ladderOn: false,
    ladder: [] as LadderRow[],
    zenText: '',
    zenFrom: '',
    rows: [] as HeatCell[][],
    weekdayLabels: WEEKDAY_LABELS,
    selDate: '',
    selText: '',
    activeDays: 0,
    soundOn: true,
    vibrateOn: true,
    ambience: 'off' as AmbienceId,
    ambienceOptions: dressList(AMBIENCE_OPTIONS, false),
    theme: 'dawn' as ThemeId,
    themeOptions: dressList(THEMES, false),
    premium: false,
    packName: PACK_NAME,
    showAdmin: false,
  },

  _alive: false,
  _resuming: false,
  _verified: false,
  _previewTimer: 0,

  onLoad() {
    const app = getApp<IAppOption>()
    this._alive = true
    const zen = zenOfDay(todayStr())
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20, zenText: zen.text, zenFrom: zen.from })
  },

  onShow() {
    concealTabBar(this)
    this.load()
    this.resumePending()
    this.verifyRefund()
  },

  onHide() {
    this.stopPreview()
  },

  onUnload() {
    this._alive = false
    this.stopPreview()
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
      const map = res.map || {}
      const rows = buildHeat(map)
      const todayCount = res.todayCount || 0
      const s = settingsOf(res.user)
      const premium = res.user.premium === true
      if (premium) writePending('')
      const total = res.user.totalMerit || 0
      const lv = levelOf(total)
      let activeDays = 0
      rows.forEach((r) =>
        r.forEach((c) => {
          if (c.count > 0) activeDays += 1
        })
      )
      const sel = this.data.selDate || today
      this.setData({
        loading: false,
        totalText: fmtInt(total),
        wishCount: res.wishes.length,
        doneCount: done,
        streak: res.streak,
        todayCount,
        rate,
        level: lv.level,
        levelTitle: lv.title,
        levelPct: Math.round(lv.progress * 100),
        levelNext: lv.isMax ? '已至最高一境' : '再 ' + fmtInt(lv.nextNeed - total) + ' 叩，至「' + lv.nextTitle + '」',
        ladder: LEVELS.map((L) => ({
          level: L.level,
          title: L.title,
          need: L.need ? fmtInt(L.need) + ' 叩' : '初发心',
          reached: total >= L.need,
          cur: L.level === lv.level,
        })),
        rows,
        activeDays,
        selDate: sel,
        selText: heatCaption(sel, map[sel] || 0),
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

  toggleLadder() {
    this.setData({ ladderOn: !this.data.ladderOn })
  },

  onPickCell(e: any) {
    const date = String(e.currentTarget.dataset.date || '')
    const count = Number(e.currentTarget.dataset.count || 0)
    if (!date || date > todayStr()) return
    this.setData({ selDate: date, selText: heatCaption(date, count) })
  },

  // ===== 设置 =====
  toggleSound() {
    this.saveSetting({ soundOn: !this.data.soundOn })
  },
  toggleVibrate() {
    const on = !this.data.vibrateOn
    // 打开时震一下，让人知道开了
    if (on) vibrate(true, 'medium')
    this.saveSetting({ vibrateOn: on })
  },
  onPickAmbience(e: any) {
    const ambience = parseAmbience(e.currentTarget.dataset.id)
    if (ambience === this.data.ambience) return
    if (isPremiumAmbience(ambience) && !this.data.premium) {
      this.askUnlock()
      return
    }
    this.saveSetting({ ambience })
    this.preview(ambience)
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

  /** 选了氛围先试听几秒，再慢慢淡出；离开本页就停 */
  preview(id: AmbienceId) {
    this.stopPreview()
    if (id === 'off' || !this.data.soundOn) return
    startAmbience(id)
    this._previewTimer = setTimeout(() => {
      this._previewTimer = 0
      fadeOutAmbience(1200).then(() => {
        if (!this._previewTimer) stopAmbience()
      })
    }, PREVIEW_MS) as unknown as number
  },

  stopPreview() {
    if (this._previewTimer) {
      clearTimeout(this._previewTimer)
      this._previewTimer = 0
    }
    stopAmbience()
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

  onShareAppMessage() {
    return { title: '「' + this.data.zenText + '」 · 小叩木鱼', path: '/pages/gate/index' }
  },
})
