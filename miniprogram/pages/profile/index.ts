// 静心
import {
  fetchProfile,
  updateSettings,
  UserSettings,
  settingsOf,
  channelAdminCheck,
  rememberUser,
} from '../../utils/cloud'
import { AMBIENCE_OPTIONS, AmbienceId, isPremiumAmbience, parseAmbience } from '../../utils/audioCatalog'
import { isPremiumTheme, parseTheme, ThemeId, THEMES, themeOf } from '../../utils/theme'
import { buyPremium, checkRefund, resumePending, writePending, PACK_NAME, packPrice } from '../../utils/premium'
import { fmtInt, todayStr, offsetDate, weekdayMon0, fmtMD, concealTabBar, weekdayCN, winInfo } from '../../utils/util'
import { SESSION_PLANS, planMix, triedPlans } from '../../utils/sessionPlans'
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
  /** 主题色块的背景样式；氛围没有 */
  swatch: string
}

/** 设置里能选的：没开静心包只列免费的，付费的都在静心包那一块里 */
function dressList(
  list: { id: string; name: string; premium?: boolean; swatch?: [string, string] }[],
  premium: boolean
): DressOption[] {
  return list
    .filter((item) => premium || !item.premium)
    .map((item) => ({ id: item.id, name: item.name, swatch: item.swatch ? swatchStyle(item.swatch) : '' }))
}

/** 主题小样下面那行字：哪一套、换了什么 */
function stagePatch(id: ThemeId) {
  const t = themeOf(id)
  return { previewTheme: t.id, previewName: t.name, previewDesc: t.desc }
}

const swatchStyle = (s: [string, string]) => 'background: linear-gradient(180deg, ' + s[0] + ' 0%, ' + s[1] + ' 100%);'

/** 静心包那一块里列的东西：付费的氛围、主题和定课 */
const PACK_AMBIENCE = AMBIENCE_OPTIONS.filter((a) => a.premium).map((a) => ({ id: a.id, name: a.name, desc: a.desc }))
const PACK_THEMES = THEMES.filter((t) => t.premium).map((t) => ({ id: t.id, name: t.name, desc: t.desc, swatch: swatchStyle(t.swatch) }))
/** 付费定课，带上这台手机上试没试过 */
function packPlans() {
  const tried = triedPlans()
  return SESSION_PLANS.filter((p) => p.premium).map((p) => ({
    id: p.id,
    name: p.name,
    minutes: p.minutes,
    scene: p.scene,
    mix: planMix(p),
    tried: !!tried[p.id],
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
    safeBottom: 0,
    /** 正在试听的氛围：氛围签上画一个小声波 */
    playingId: '',
    // 主题小样：显示的是哪一套
    previewTheme: 'dawn' as ThemeId,
    previewName: '晨',
    previewDesc: '',
    // 静心包那一块（没开时摊在页上）
    packTheme: 'night' as ThemeId,
    packPriceText: '',
    /** 从香案哪套定课过来的：那套标上「刚试过」，页面翻到静心包 */
    packFrom: '',
    /** 页面滚到哪一块：静心包是 pack */
    scrollTo: '',
    packAmbience: PACK_AMBIENCE,
    packThemes: PACK_THEMES,
    packPlans: packPlans(),
  },

  _alive: false,
  /** 从香案过来看静心包：开了或点「回香案」都回去；null 表示是自己来的 */
  _packVisit: null as string | null,
  _previewTimer: 0,
  /** 每次试听 / 收起都换一个号，淡出结束时号对不上就别去停（香案可能已经在放自己的氛围） */
  _previewSeq: 0,

  onLoad() {
    const app = getApp<IAppOption>()
    this._alive = true
    const zen = zenOfDay(todayStr())
    let safeBottom = 0
    try {
      const win: any = winInfo()
      if (win.safeArea && win.screenHeight) safeBottom = Math.max(0, win.screenHeight - win.safeArea.bottom)
    } catch {
      safeBottom = 0
    }
    this.setData(
      Object.assign(
        { statusBarHeight: app.globalData.statusBarHeight || 20, zenText: zen.text, zenFrom: zen.from, safeBottom },
        stagePatch('dawn')
      )
    )
  },

  onShow() {
    concealTabBar(this)
    this.load()
    this.resumePending()
    const app = getApp<IAppOption>()
    const visit = app.globalData.packVisit
    app.globalData.packVisit = null
    if (typeof visit === 'string') {
      this._packVisit = visit
      this.setData({ packFrom: visit })
      this.showPack()
    }
  },

  onHide() {
    this.stopPreview()
    // 从这里切去别的页：这趟就算看完了，不再替香案记着
    this._packVisit = null
    if (this.data.packFrom) this.setData({ packFrom: '' })
  },

  onUnload() {
    this._alive = false
    this.stopPreview()
  },

  // 上一笔付款没能当场确认发货时的续查。每次回到本页都继续追，直到开启或过期，
  // 避免用户在发货到达前被要求再次付费。香案也会追同一趟
  async resumePending() {
    if (await resumePending()) {
      if (this._alive) this.markPremium()
    }
  },

  /** 开着静心包的：隔一阵问一次是否已退款（utils/premium 里节流），退了就重新拉资料，锁回去 */
  recheckRefund() {
    checkRefund().then((refunded) => {
      if (!refunded || !this._alive) return
      // 先立即把锁定态撤掉，不等 load() 回来：否则退款后本页还显示已开启、还在放付费氛围
      this.setData({
        premium: false,
        ambience: 'off' as AmbienceId,
        ambienceOptions: dressList(AMBIENCE_OPTIONS, false),
        theme: 'dawn' as ThemeId,
        themeOptions: dressList(THEMES, false),
      })
      try {
        stopAmbience()
      } catch (e) {
        // ignore
      }
      this.load()
    })
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
      rememberUser(res.user)
      const s = settingsOf(res.user)
      const premium = res.user.premium === true
      if (premium) writePending('')
      if (premium) this.recheckRefund()
      const total = res.user.totalMerit || 0
      const lv = levelOf(total)
      let activeDays = 0
      rows.forEach((r) =>
        r.forEach((c) => {
          if (c.count > 0) activeDays += 1
        })
      )
      const sel = this.data.selDate || today
      this.setData(Object.assign({
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
        packPlans: packPlans(),
      }, stagePatch(s.theme)))
      if (!premium) this.loadPackPrice()
      // 从香案过来的：静心包那一块要等资料到了才画出来，画出来再翻过去
      if (!premium && this._packVisit !== null) this.showPack()
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
    if (isPremiumAmbience(ambience) && !this.data.premium) {
      // 设置里不列付费的；万一点到了，就去静心包那一块听
      this.showPack()
      this.listen(ambience)
      return
    }
    if (ambience === this.data.ambience) {
      // 再点一下已选的：再听一遍
      if (this.data.playingId !== ambience) this.preview(ambience)
      return
    }
    this.saveSetting({ ambience })
    this.preview(ambience)
  },
  /** 点色块：小样马上换成这一套，并存下（主题这一项只在开了静心包后出现） */
  onPickTheme(e: any) {
    const theme = parseTheme(e.currentTarget.dataset.id)
    this.setData(stagePatch(theme))
    if (theme === this.data.theme) return
    if (isPremiumTheme(theme) && !this.data.premium) return
    this.saveSetting({ theme })
  },

  /** 选了氛围先试听几秒，再慢慢淡出；离开本页就停 */
  preview(id: AmbienceId) {
    this.stopPreview()
    if (id === 'off' || !this.data.soundOn) return
    startAmbience(id)
    this.setData({ playingId: id })
    const seq = this._previewSeq
    this._previewTimer = setTimeout(() => {
      this._previewTimer = 0
      fadeOutAmbience(1200).then(() => {
        if (this._previewSeq !== seq) return
        stopAmbience()
        if (this._alive) this.setData({ playingId: '' })
      })
    }, PREVIEW_MS) as unknown as number
  },

  stopPreview() {
    this._previewSeq += 1
    if (this._previewTimer) {
      clearTimeout(this._previewTimer)
      this._previewTimer = 0
    }
    stopAmbience()
    if (this._alive && this.data.playingId) this.setData({ playingId: '' })
  },

  /** 试听一种氛围（不存设置）；音效关着时说一声，不然点了没声音像是坏了 */
  listen(id: AmbienceId) {
    if (!this.data.soundOn) {
      wx.showToast({ title: '音效关着 · 打开后可试听', icon: 'none' })
      return
    }
    this.preview(id)
  },

  // ===== 静心包 =====
  /** 翻到静心包那一块。先清空再设，同一个目标也能再滚一次 */
  showPack() {
    if (this.data.premium) return
    this.setData({ scrollTo: '' })
    setTimeout(() => {
      if (this._alive) this.setData({ scrollTo: 'pack' })
    }, 60)
  },

  loadPackPrice() {
    if (this.data.packPriceText) return
    packPrice().then((p) => {
      if (this._alive && p) this.setData({ packPriceText: '¥' + p })
    })
  },

  /** 从香案过来、先不开：回香案原处 */
  onPackBack() {
    this.stopPreview()
    this.backToAltar(false)
  },

  /** 从香案的定课过来的：回香案。开了就让香案提示一声、接着那套定课。返回是否回去了 */
  backToAltar(opened: boolean): boolean {
    const visit = this._packVisit
    this._packVisit = null
    if (visit === null) return false
    const app = getApp<IAppOption>()
    if (opened) app.globalData.packOpened = visit
    app.globalData.homeEnterAnim = true
    concealTabBar(this)
    wx.switchTab({ url: '/pages/home/index' })
    return true
  },

  onPackListen(e: any) {
    const id = parseAmbience(e.currentTarget.dataset.id)
    if (this.data.playingId === id) {
      this.stopPreview()
      return
    }
    this.listen(id)
  },

  onPackTheme(e: any) {
    this.setData({ packTheme: parseTheme(e.currentTarget.dataset.id) })
  },

  onPackBuy() {
    this.stopPreview()
    this.beginUnlock()
  },

  /** 云端说这项要静心包（比如本机缓存还当它开着）：翻到静心包 */
  askUnlock() {
    this.showPack()
  },

  /** 开了：静心包那一块收成一行，付费的氛围、主题并进设置 */
  markPremium() {
    this.setData({
      premium: true,
      ambienceOptions: dressList(AMBIENCE_OPTIONS, true),
      themeOptions: dressList(THEMES, true),
      packFrom: '',
      scrollTo: '',
    })
  },

  async beginUnlock() {
    const r = await buyPremium(() => this._alive)
    if (!this._alive) return
    if (r === 'opened') {
      this.markPremium()
      // 从香案过来的回香案，由那边提示
      if (!this.backToAltar(true)) wx.showToast({ title: '静心包已开启', icon: 'none' })
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
    // 别的页面（心愿列表的长按震动等）读的是这份缓存
    const app = getApp<IAppOption>()
    if (app.globalData.user) app.globalData.user.settings = Object.assign({}, settingsOf(app.globalData.user), patch)
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
      // 只按真实管理员显示入口：不再有「第一个进来的人可以认领」这回事
      this.setData({
        showAdmin: !!admin.isAdmin,
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
