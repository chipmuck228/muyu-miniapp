// 木鱼香案：选完今日功课后敲击；从其他 Tab 切回时播放短暗幕
import {
  fetchHome,
  fetchWishDetail,
  fetchWishes,
  UserRecord,
  settingsOf,
  bindChannelByScene,
  normalizeChannelScene,
  IncenseState,
  lightIncense,
  snuffIncense,
  settleIncense,
} from '../../utils/cloud'
import { CHANTS, INCENSE_ON, INCENSE_MINUTES, INCENSE_RATE } from '../../utils/constants'
import { playKnock, vibrate, ensureKnock } from '../../utils/knock'
import { KnockQueue, TapSource } from '../../utils/knockQueue'
import { mockEnabled } from '../../utils/devMock'
import { concealTabBar, winInfo } from '../../utils/util'
import { DAWN_FILE_ID, resolveCloudFile } from '../../utils/cloudFile'
import { startAmbience, stopAmbience } from '../../utils/ambience'
import { AmbienceId } from '../../utils/audioCatalog'
import { parseTheme, themeEnds, ThemeId } from '../../utils/theme'
import { applyLesson, nextLesson, LessonPick, RANDOM_NAME, RANDOM_LESSON } from '../../utils/lesson'

interface FloatItem {
  key: number
  text: string
  left: number
  kind: 'score' | 'chant' | 'celebrate'
}

type EnterPhase = 'cover' | 'reveal' | 'done'
type EnterKind = 'first' | 'back'

interface SheetRow {
  _id: string
  name: string
  mark: string
  cur: boolean
}

interface CelebrateInfo {
  name: string
  goalText: string
  thumbUrl: string
  /** 关掉弹窗后接着敲的功课，提前告诉用户 */
  nextText: string
}

const SWITCH_HINT_MS = 2600

// 一炷香：平时烟头在画面 86% 处藏在木鱼后（pkg-smoke/incensePlume.ts 的 originYRatio）。
// 燃香时木鱼隐去，烟头升到 70% 处，香身从烟头往下插进香炉（避开底部回堂把手），燃烧时香头和烟一起往下走
const PLUME_BASE = 86
const STICK_TOP = 70
const STICK_LEN = 12
const STICK_BURN = 10

interface IncenseOption {
  minutes: number
  gain: number
}

function incenseOptions(): IncenseOption[] {
  // 开发版本地模拟多一个 1 分钟，方便看燃尽
  const list = mockEnabled() ? [1].concat(INCENSE_MINUTES) : INCENSE_MINUTES
  return list.map((m) => ({ minutes: m, gain: m * INCENSE_RATE }))
}

function clockText(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s
}

// 木鱼材质（渲染参数在 pkg-smoke/muyuFish.ts；分包代码主包不能同步引用，这里只放名字和色点）
const MATERIAL_KEY = 'muyu_material'
const MATERIALS = [
  { id: 'zitan', name: '紫檀', dot: 'radial-gradient(circle at 34% 26%, #a55014, #3d1a06)' },
  { id: 'huali', name: '黄花梨', dot: 'radial-gradient(circle at 34% 26%, #e0a35a, #6b3d12)' },
  { id: 'liuli', name: '琉璃', dot: 'radial-gradient(circle at 34% 26%, #8fd3ff, #0b4f8a)' },
  { id: 'yu', name: '玉', dot: 'radial-gradient(circle at 34% 26%, #b8f0d0, #2f7a5c)' },
]
/** 手指移动超过这个距离（px）就算拖动，不算敲击 */
const DRAG_SLOP = 6

function savedMaterial(): string {
  try {
    const v = wx.getStorageSync(MATERIAL_KEY)
    if (MATERIALS.some((m) => m.id === v)) return v
  } catch {
    // 用默认
  }
  return 'zitan'
}

function nextTextOf(p: LessonPick): string {
  return p.mode === 'wish' ? '接下来专注：' + p.name : '心愿都已圆满，接下来随机专注'
}

function bindWishId(): string | null {
  const app = getApp<IAppOption>()
  if (app.globalData.knockMode === 'wish') return app.globalData.knockWishId || null
  return null
}

const LESSON_TITLE_MAX = 8
const TITLE_FADE_MS = 1600
const RANDOM_GOAL = 10
function progressT(cur: number, goal: number): number {
  return goal > 0 ? Math.max(0, Math.min(1, cur / goal)) : 0
}

function mixTitleColor(cur: number, goal: number, theme?: ThemeId): string {
  const ends = themeEnds(theme || 'dawn')
  const t = progressT(cur, goal)
  const r = Math.round(ends.from.r + (ends.to.r - ends.from.r) * t)
  const g = Math.round(ends.from.g + (ends.to.g - ends.from.g) * t)
  const b = Math.round(ends.from.b + (ends.to.b - ends.from.b) * t)
  return 'rgb(' + r + ',' + g + ',' + b + ')'
}

function scenePatch(cur: number, goal: number, theme?: ThemeId) {
  const t = progressT(cur, goal)
  return {
    lessonColor: mixTitleColor(cur, goal, theme),
    dawnSky: Number(t.toFixed(3)),
    smokeFade: Number((1 - t * 0.92).toFixed(3)),
  }
}

function lessonTitleOf(): string {
  const app = getApp<IAppOption>()
  if (app.globalData.knockMode === 'wish' && app.globalData.knockWishId) {
    return app.globalData.knockWishName || '心愿'
  }
  return RANDOM_NAME
}

function lessonCharsOf(name: string): string[] {
  const s = (name || '').trim()
  if (s.length <= LESSON_TITLE_MAX) return s.split('')
  return s.slice(0, LESSON_TITLE_MAX - 1).split('').concat('…')
}

function lessonTitlePatch(name: string): { lessonTitle: string; lessonChars: string[] } {
  return { lessonTitle: name, lessonChars: lessonCharsOf(name) }
}

Page({
  data: {
    statusBarHeight: 20,
    readyToKnock: false,
    loading: true,
    totalMerit: 0,
    todayCount: 0,
    soundOn: true,
    vibrateOn: true,
    autoMode: false,
    ambience: 'off' as AmbienceId,
    theme: 'dawn' as ThemeId,
    floats: [] as FloatItem[],
    rippleOn: false,
    pulsing: false,
    enterPhase: 'done' as EnterPhase,
    enterKind: 'first' as EnterKind,
    lessonTitle: '',
    lessonChars: [] as string[],
    lessonTitleOn: false,
    lessonColor: mixTitleColor(0, 1, 'dawn'),
    dawnSky: 0,
    smokeFade: 1,
    dawnSrc: '',
    // 顶部当前功课：心愿显示 进度/目标，随机专注显示今日次数
    headWish: false,
    headReady: false,
    headCur: 0,
    headGoal: 0,
    headPct: 0,
    celebrateOn: false,
    celebrate: null as CelebrateInfo | null,
    /** 圆满后切到下一个功课时，顶部短暂提示 */
    switchHint: '',
    /** 每敲一下 +1，驱动 3D 木鱼回弹 */
    strikeSeq: 0,
    // 「今日功课」底部面板：切换心愿 / 随机专注 / 立新愿
    sheetOn: false,
    sheetFirst: false,
    sheetLoading: false,
    sheetRows: [] as SheetRow[],
    sheetRandomCur: false,
    materials: MATERIALS,
    material: savedMaterial(),
    // 一炷香：燃烧中木鱼静置，按云端时钟倒计时
    incenseOn: false,
    incenseLeft: '',
    incenseGain: 0,
    incenseSink: 0,
    incenseTop: STICK_TOP,
    incenseLen: STICK_LEN,
    incenseSheetOn: false,
    incenseOptions: [] as IncenseOption[],
    incenseBusy: false,
    incenseFeature: INCENSE_ON,
  },

  _floatSeq: 0,
  _pulseTimer: 0,
  _autoTimer: 0,
  _enterTimer: 0,
  _queue: null as KnockQueue | null,
  _wishId: null as string | null,
  _alive: false,
  _hasEntered: false,
  _titleTimer: 0,
  _titleCurrent: 0,
  _titleGoal: RANDOM_GOAL,
  _randomHits: 0,
  _lessonKind: '' as '' | 'wish' | 'random',
  _titleCanvas: null as any,
  _titleCtx: null as any,
  _titleCssW: 0,
  _titleCssH: 0,
  /** 竖排标题这次显出的时刻，0 表示正隐去 */
  _titleShownAt: 0,
  _titleFadeRaf: 0,
  _celebrateId: '' as string,
  _nextPick: null as Promise<LessonPick> | null,
  _hintTimer: 0,
  _touchX: 0,
  _touchY: 0,
  _touchMoved: 0,
  _dragging: false,
  _incense: null as IncenseState | null,
  /** 云端时钟 - 本机时钟 */
  _clockSkew: 0,
  _incenseTimer: 0,
  _settling: false,
  onLoad(options: Record<string, string | undefined>) {
    const app = getApp<IAppOption>()
    const scene =
      normalizeChannelScene(String((options && (options.scene || options.ch)) || '')) ||
      normalizeChannelScene(String(app.globalData.pendingChannelScene || ''))
    if (scene) {
      app.globalData.pendingChannelScene = scene
      bindChannelByScene(scene).catch(() => {})
    }
    const cached = settingsOf(app.globalData.user)
    this.setData(
      Object.assign(
        {
          statusBarHeight: app.globalData.statusBarHeight || 20,
          readyToKnock: !!app.globalData.lessonChosen,
          ambience: cached.ambience,
          theme: cached.theme,
          lessonColor: mixTitleColor(0, 1, cached.theme),
        },
        app.globalData.lessonChosen ? lessonTitlePatch(lessonTitleOf()) : {}
      )
    )
    this._alive = true
    this._queue = new KnockQueue(
      () => this._wishId,
      (r) => {
        if (!this._alive) return
        if (r.completed) this.celebrateWish()
        this.setData(this.levelPatch(r.totalMerit, r.todayCount))
      },
      () => {
        if (this._alive) {
          wx.showToast({ title: '专注未能上传，请重试', icon: 'none' })
        }
      }
    )
    this.loadDawn()
  },

  loadDawn() {
    resolveCloudFile(DAWN_FILE_ID)
      .then((src) => {
        if (this._alive) this.setData({ dawnSrc: src })
      })
      .catch((e) => {
        console.warn('dawn load failed', e)
      })
  },

  onShow() {
    const app = getApp<IAppOption>()
    if (!app.globalData.lessonChosen) {
      // 没经过入堂（如扫码直达）：先按随机专注摆好，再弹面板让用户选
      applyLesson(RANDOM_LESSON, false)
      app.globalData.openLessonSheet = true
    }
    const prevWishId = this._wishId
    this._wishId = bindWishId()
    if (this._wishId !== prevWishId && this._lessonKind === 'wish') {
      // 从今日功课换了心愿：旧进度作废，等新心愿拉回来再显示数字
      this._lessonKind = ''
      this._titleCurrent = 0
    }
    this.setData({ readyToKnock: true })
    if (!this.data.dawnSrc) this.loadDawn()
    ensureKnock()
    startAmbience(this.data.ambience)
    this.armLessonTitle()
    concealTabBar(this)
    if (this._incense) this.startIncenseTick()
    this.refresh()
    this.tryEnter()
    // 自动敲只在本次打开内有效：切页、锁屏回来接着敲，重开小程序从手敲开始
    if (this.data.autoMode && !this.entering() && !this.overlayOn()) this.startAuto()
    if (app.globalData.openLessonSheet) {
      app.globalData.openLessonSheet = false
      // 先让香案亮出来，再升起面板
      setTimeout(() => {
        if (this._alive) this.openSheet(true)
      }, 700)
    } else if (this.data.sheetOn) {
      // 从面板去立愿后回来：刷新列表，新心愿就在里面
      this.loadSheet()
    }
  },

  onHide() {
    // 香照常燃（云端计时），只停本页的倒计时
    this.stopIncenseTick()
    this.stopAuto()
    stopAmbience()
    this.clearEnterTimer()
    this.clearTitleTimer()
    this._titleCtx = null
    this._titleCanvas = null
    this._titleCssW = 0
    this._titleCssH = 0
    this._titleShownAt = 0
    this._titleFadeRaf = 0
    this.setData({ lessonTitleOn: false })
    const app = getApp<IAppOption>()
    if (app.globalData.homeWillReenter) {
      this.setData({
        enterPhase: 'cover',
        enterKind: 'back',
        floats: [],
        pulsing: false,
        rippleOn: false,
      })
    }
  },

  onUnload() {
    this._alive = false
    if (this._hintTimer) clearTimeout(this._hintTimer)
    this.stopIncenseTick()
    this.stopAuto()
    stopAmbience()
    this.clearEnterTimer()
    this.clearTitleTimer()
    if (this._queue) {
      this._queue.destroy()
      this._queue = null
    }
  },

  tryEnter() {
    const app = getApp<IAppOption>()
    const fromGate = !!app.globalData.fromGate
    app.globalData.fromGate = false
    const fromTab = !!app.globalData.homeEnterAnim
    app.globalData.homeEnterAnim = false
    app.globalData.homeWillReenter = false

    if (fromGate) {
      this._hasEntered = true
      if (this.data.enterPhase !== 'done') this.setData({ enterPhase: 'done' })
      return
    }

    const needEnter = fromTab || this.data.enterPhase === 'cover'
    if (!needEnter) {
      this._hasEntered = true
      return
    }
    this.playEnter('back')
  },

  playEnter(kind: EnterKind) {
    this.clearEnterTimer()
    const beginReveal = () => {
      if (!this._alive) return
      this.setData({ enterPhase: 'reveal', enterKind: kind })
      this._enterTimer = setTimeout(() => {
        this._enterTimer = 0
        if (!this._alive) return
        this._hasEntered = true
        this.setData({ enterPhase: 'done' })
        if (this.data.autoMode && !this.overlayOn()) this.startAuto()
      }, 560)
    }
    const arm = () => {
      this._enterTimer = setTimeout(beginReveal, 40)
    }
    if (this.data.enterPhase !== 'cover') {
      this.setData({ enterPhase: 'cover', enterKind: kind })
      wx.nextTick(arm)
    } else {
      if (this.data.enterKind !== kind) this.setData({ enterKind: kind })
      wx.nextTick(arm)
    }
  },

  clearEnterTimer() {
    if (this._enterTimer) {
      clearTimeout(this._enterTimer)
      this._enterTimer = 0
    }
  },

  clearTitleTimer() {
    if (this._titleTimer) {
      clearTimeout(this._titleTimer)
      this._titleTimer = 0
    }
  },

  titleColorPatch() {
    const isWish = getApp<IAppOption>().globalData.knockMode === 'wish'
    const ready = this._lessonKind === 'wish'
    return Object.assign(scenePatch(this._titleCurrent, this._titleGoal, parseTheme(this.data.theme)), {
      headWish: isWish,
      headReady: ready,
      headCur: isWish ? this._titleCurrent : 0,
      headGoal: isWish ? this._titleGoal : 0,
      headPct: isWish ? Math.round(progressT(this._titleCurrent, this._titleGoal) * 1000) / 10 : 0,
    })
  },

  applyTitleProgress() {
    if (!this._alive) return
    this.setData(this.titleColorPatch())
    this.drawLessonTitle()
  },

  armLessonTitle() {
    this.clearTitleTimer()
    this.setData(Object.assign(lessonTitlePatch(lessonTitleOf()), { lessonTitleOn: false }, this.titleColorPatch()))
    this.syncTitleProgress()
    this._titleTimer = setTimeout(() => {
      this._titleTimer = 0
      if (!this._alive) return
      this.setData({ lessonTitleOn: true })
      this.drawLessonTitle()
    }, 1200)
  },

  async syncTitleProgress() {
    const app = getApp<IAppOption>()
    const id = app.globalData.knockWishId
    if (app.globalData.knockMode === 'wish' && id) {
      // 拉到心愿进度后才算就绪，避免顶部先闪出上一个心愿的数字
      try {
        const res = await fetchWishDetail(id)
        if (!this._alive) return
        if (!res.wish || res.wish.status !== 'ongoing') {
          // 上次的心愿已圆满或已删除：接着下一个进行中的心愿
          this.switchLesson(await nextLesson(id))
          return
        }
        const name = res.wish.name || '心愿'
        if (name !== app.globalData.knockWishName) {
          applyLesson({ mode: 'wish', wishId: id, name })
        }
        this._lessonKind = 'wish'
        this._titleGoal = Math.max(1, res.wish.goal || 1)
        this._titleCurrent = Math.max(0, Math.min(this._titleGoal, res.wish.current || 0))
        this.setData(Object.assign(lessonTitlePatch(name), this.titleColorPatch()))
        this.drawLessonTitle()
      } catch {
        this._lessonKind = 'wish'
        this.applyTitleProgress()
      }
      return
    }
    if (this._lessonKind !== 'random') this._randomHits = 0
    this._lessonKind = 'random'
    this._titleGoal = RANDOM_GOAL
    this._titleCurrent = this._randomHits
    this.setData(Object.assign(lessonTitlePatch(lessonTitleOf()), this.titleColorPatch()))
    this.drawLessonTitle()
  },

  onSmokeRisen() {
    this.clearTitleTimer()
    if (!this._alive) return
    this.setData({ lessonTitleOn: true })
    this.drawLessonTitle()
  },

  paintLessonTitle(ctx: any, w: number, h: number) {
    const chars = this.data.lessonChars || []
    ctx.clearRect(0, 0, w, h)
    // 画布会盖在普通视图之上：圆满弹窗打开时先擦掉竖排标题，否则会叠在弹窗文字上
    if (!this.data.lessonTitleOn || this.overlayOn() || !chars.length) {
      this._titleShownAt = 0
      return
    }
    // 每次从隐去到显出都慢慢浮现
    const now = Date.now()
    if (!this._titleShownAt) this._titleShownAt = now
    const t = Math.min(1, (now - this._titleShownAt) / TITLE_FADE_MS)
    ctx.globalAlpha = t * t * (3 - 2 * t)
    ctx.fillStyle = this.data.lessonColor || mixTitleColor(this._titleCurrent, this._titleGoal, parseTheme(this.data.theme))
    // 画布宽 88rpx：字号 34rpx、行高 1.45，随屏宽缩放
    const size = (w * 34) / 88
    const line = size * 1.45
    ctx.font = size.toFixed(1) + 'px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const total = chars.length * line
    let y = (h - total) / 2 + line / 2
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], w / 2, y)
      y += line
    }
    ctx.globalAlpha = 1
    if (t < 1 && !this._titleFadeRaf) {
      const next = () => {
        this._titleFadeRaf = 0
        if (this._alive && this._titleCtx === ctx) this.paintLessonTitle(ctx, w, h)
      }
      const cv = this._titleCanvas
      this._titleFadeRaf =
        cv && typeof cv.requestAnimationFrame === 'function'
          ? cv.requestAnimationFrame(next)
          : (setTimeout(next, 16) as unknown as number)
    }
  },

  drawLessonTitle() {
    wx.nextTick(() => {
      if (!this._alive) return
      if (this._titleCtx && this._titleCssW) {
        this.paintLessonTitle(this._titleCtx, this._titleCssW, this._titleCssH)
        return
      }
      const q: any = wx.createSelectorQuery().in(this)
      q.select('#lessonTitleCanvas')
        .fields({ node: true, size: true })
        .exec((res: any[]) => {
          const item = res && res[0]
          if (!item || !item.node || !item.width || !item.height) return
          const canvas = item.node
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          let dpr = 2
          try {
            dpr = Math.max(1, Math.min(Number(winInfo().pixelRatio) || 2, 2))
          } catch {
            dpr = 2
          }
          const w = item.width
          const h = item.height
          canvas.width = Math.round(w * dpr)
          canvas.height = Math.round(h * dpr)
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          this._titleCanvas = canvas
          this._titleCtx = ctx
          this._titleCssW = w
          this._titleCssH = h
          this.paintLessonTitle(ctx, w, h)
        })
    })
  },

  entering(): boolean {
    return this.data.enterPhase !== 'done'
  },

  levelPatch(total: number, todayCount?: number): any {
    const patch: any = {
      totalMerit: Math.max(0, total || 0),
    }
    if (typeof todayCount === 'number') patch.todayCount = todayCount
    return patch
  },

  async refresh() {
    try {
      const res = await fetchHome()
      if (!this._alive) return
      this.applyHome(res.user, res.todayCount)
      this.syncIncense(res.user && res.user.incense, res.serverNow)
    } catch (e: any) {
      if (this._alive) {
        this.setData({ loading: false })
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
      }
    }
  },

  applyHome(user: UserRecord, todayCount: number) {
    this._wishId = bindWishId()
    const s = settingsOf(user)
    this.setData(
      Object.assign(
        {
          loading: false,
          soundOn: s.soundOn,
          vibrateOn: s.vibrateOn,
          ambience: s.ambience,
          theme: s.theme,
        },
        this.levelPatch(user.totalMerit || 0, todayCount),
        scenePatch(this._titleCurrent, this._titleGoal, s.theme)
      )
    )
    this.setData(this.titleColorPatch())
    this.drawLessonTitle()
    startAmbience(s.ambience)
  },

  onKnockTap() {
    // 刚拖过木鱼：这次松手不算敲击
    if (this._dragging) {
      this._dragging = false
      return
    }
    this.knock('hand')
  },

  muyuComp(): any {
    const c: any = this.selectComponent('#muyu')
    // 分包还没加载完时是占位 view，没有这些方法
    return c && typeof c.rotateBy === 'function' ? c : null
  },

  onPadTouchStart(e: any) {
    const t = e.touches && e.touches[0]
    if (!t) return
    this._touchX = t.clientX
    this._touchY = t.clientY
    this._touchMoved = 0
    this._dragging = false
  },

  onPadTouchMove(e: any) {
    const t = e.touches && e.touches[0]
    if (!t) return
    const dx = t.clientX - this._touchX
    const dy = t.clientY - this._touchY
    this._touchX = t.clientX
    this._touchY = t.clientY
    this._touchMoved += Math.abs(dx) + Math.abs(dy)
    if (!this._dragging && this._touchMoved < DRAG_SLOP) return
    const comp = this.muyuComp()
    if (!comp) return
    if (!this._dragging) {
      this._dragging = true
      comp.setDragging(true)
    }
    comp.rotateBy(dx, dy)
  },

  onPadTouchEnd() {
    if (!this._dragging) return
    const comp = this.muyuComp()
    if (comp) comp.setDragging(false)
    // 有的机型拖完不触发 tap，下次按下时会重置
  },

  onPickMaterial(e: any) {
    const id = (e.currentTarget.dataset.id as string) || ''
    const m = MATERIALS.find((x) => x.id === id)
    if (!m || m.id === this.data.material) return
    this.setData({ material: m.id })
    try {
      wx.setStorageSync(MATERIAL_KEY, m.id)
    } catch {
      // 下次启动回到默认材质
    }
    wx.showToast({ title: m.name, icon: 'none', duration: 900 })
  },

  knock(source: TapSource) {
    if (!this._alive || this.entering() || !this.data.readyToKnock || this.overlayOn() || this._incense) return
    const d = this.data
    playKnock(d.soundOn)
    vibrate(d.vibrateOn)
    this.spawnFloat()
    this.pulse()
    this.ripple()

    const nextTotal = d.totalMerit + 1
    this._titleCurrent = Math.min(this._titleGoal, this._titleCurrent + 1)
    if (this._lessonKind === 'random') this._randomHits = this._titleCurrent
    this.setData(
      Object.assign(this.levelPatch(nextTotal, d.todayCount + 1), this.titleColorPatch(), { strikeSeq: d.strikeSeq + 1 })
    )
    this.drawLessonTitle()
    if (this._queue) this._queue.tap(source)
  },

  /** 右下角「自动」开关：随时切换，不存云端 */
  onToggleAuto() {
    if (this.entering() || this.overlayOn() || this._incense) return
    const on = !this.data.autoMode
    this.setData({ autoMode: on })
    if (on) this.startAuto()
    else this.stopAuto()
  },

  startAuto() {
    if (this._autoTimer || this.entering() || this._incense) return
    this._autoTimer = setInterval(() => {
      if (this._alive) this.knock('auto')
    }, 800)
  },
  stopAuto() {
    if (this._autoTimer) {
      clearInterval(this._autoTimer)
      this._autoTimer = 0
    }
  },

  spawnFloat() {
    const text = Math.random() < 0.55 ? '专注 +1' : CHANTS[Math.floor(Math.random() * CHANTS.length)]
    this.spawnText(text, text.indexOf('+') >= 0 ? 'score' : 'chant')
  },

  spawnText(text: string, kind: FloatItem['kind']) {
    this._floatSeq += 1
    const floats = this.data.floats.slice()
    if (floats.length > 5) floats.shift()
    floats.push({
      key: this._floatSeq,
      text,
      left: kind === 'celebrate' ? 50 : 26 + Math.random() * 44,
      kind,
    })
    this.setData({ floats })
    const key = this._floatSeq
    setTimeout(
      () => {
        if (!this._alive) return
        this.setData({ floats: this.data.floats.filter((f) => f.key !== key) })
      },
      kind === 'celebrate' ? 2400 : 1000
    )
  },

  ripple() {
    if (this.data.rippleOn) this.setData({ rippleOn: false })
    wx.nextTick(() => {
      if (this._alive) this.setData({ rippleOn: true })
    })
  },

  pulse() {
    this.setData({ pulsing: false })
    wx.nextTick(() => {
      if (this._alive) this.setData({ pulsing: true })
    })
    if (this._pulseTimer) clearTimeout(this._pulseTimer)
    this._pulseTimer = setTimeout(() => {
      if (this._alive) this.setData({ pulsing: false })
    }, 240)
  },

  switchLesson(p: LessonPick) {
    if (!this._alive) return
    applyLesson(p)
    this._wishId = bindWishId()
    this._lessonKind = ''
    this._randomHits = 0
    this._titleCurrent = 0
    this._titleGoal = p.mode === 'wish' ? 1 : RANDOM_GOAL
    this.syncTitleProgress()
  },

  /** 弹窗 / 面板盖在香案上：画布是原生层，要暂停木鱼、隐去烟和竖排标题 */
  overlayOn(): boolean {
    return this.data.celebrateOn || this.data.sheetOn || this.data.incenseSheetOn
  },

  onOpenLessonPanel() {
    if (this.entering() || this.overlayOn()) return
    if (this._incense) {
      wx.showToast({ title: '香燃尽或掐灭后再换功课', icon: 'none' })
      return
    }
    this.openSheet(false)
  },

  openSheet(first: boolean) {
    this.stopAuto()
    this.setData({ sheetOn: true, sheetFirst: first, sheetLoading: !this.data.sheetRows.length })
    this.drawLessonTitle()
    this.loadSheet()
  },

  async loadSheet() {
    const app = getApp<IAppOption>()
    const curId = app.globalData.knockMode === 'wish' ? app.globalData.knockWishId : null
    let rows: SheetRow[] = []
    try {
      const res = await fetchWishes()
      rows = (res.wishes || [])
        .filter((w) => w.status === 'ongoing')
        .map((w) => ({
          _id: w._id,
          name: w.name || '无名心愿',
          mark: w.current + ' / ' + w.goal,
          cur: w._id === curId,
        }))
    } catch {
      rows = []
    }
    if (!this._alive || !this.data.sheetOn) return
    this.setData({ sheetLoading: false, sheetRows: rows, sheetRandomCur: !curId })
  },

  closeSheet() {
    if (!this.data.sheetOn) return
    if (this.data.sheetFirst) {
      // 首次没选就收起：就按随机专注，并记住，下次不再弹
      const app = getApp<IAppOption>()
      if (app.globalData.knockMode !== 'wish') applyLesson(RANDOM_LESSON)
    }
    this.setData({ sheetOn: false, sheetFirst: false })
    this.drawLessonTitle()
    if (this.data.autoMode && !this.entering() && !this.data.celebrateOn) this.startAuto()
  },

  onSheetPick(e: any) {
    const id = (e.currentTarget.dataset.id as string) || ''
    const row = this.data.sheetRows.find((r) => r._id === id)
    if (!row) return
    if (!row.cur) this.switchLesson({ mode: 'wish', wishId: row._id, name: row.name })
    this.setData({ sheetFirst: false })
    this.closeSheet()
  },

  onSheetRandom() {
    if (!this.data.sheetRandomCur) this.switchLesson(RANDOM_LESSON)
    else applyLesson(RANDOM_LESSON)
    this.setData({ sheetFirst: false })
    this.closeSheet()
  },

  onSheetNew() {
    wx.navigateTo({ url: '/pages/wish-form/index' })
  },

  /** 心愿敲满：停住敲击，弹出圆满；关掉时再切到下一个心愿 */
  celebrateWish() {
    const id = this._wishId
    if (!id || this._celebrateId) return
    this._celebrateId = id
    this._wishId = null
    this.stopAuto()
    this.setData({
      celebrateOn: true,
      celebrate: {
        name: this.data.lessonTitle || '心愿',
        goalText: String(this._titleGoal),
        thumbUrl: '',
        nextText: '',
      },
    })
    this.drawLessonTitle()
    // 先算好下一个功课，弹窗里就能告诉用户「继续敲击」会去哪
    const pick = nextLesson(id)
    this._nextPick = pick
    pick.then((p) => {
      if (this._alive && this._celebrateId === id && this.data.celebrate) {
        this.setData({ 'celebrate.nextText': nextTextOf(p) })
      }
    })
    fetchWishDetail(id)
      .then((res) => {
        const thumbUrl = (res.wish && res.wish.thumbUrl) || ''
        if (this._alive && thumbUrl && this._celebrateId === id && this.data.celebrate) {
          this.setData({ 'celebrate.thumbUrl': thumbUrl })
        }
      })
      .catch(() => {})
  },

  endCelebrate(): string {
    const id = this._celebrateId
    this._celebrateId = ''
    this.setData({ celebrateOn: false })
    this.drawLessonTitle()
    return id
  },

  takeNextPick(id: string): Promise<LessonPick> {
    const pick = this._nextPick || nextLesson(id)
    this._nextPick = null
    return pick
  },

  async onCelebrateContinue() {
    const id = this.endCelebrate()
    const p = await this.takeNextPick(id)
    this.switchLesson(p)
    this.showSwitchHint(p.mode === 'wish' ? '已切换到下一个心愿' : '心愿都已圆满 · 已转入随机专注')
    if (this.data.autoMode && !this.entering()) this.startAuto()
  },

  showSwitchHint(text: string) {
    if (this._hintTimer) clearTimeout(this._hintTimer)
    this.setData({ switchHint: text })
    this._hintTimer = setTimeout(() => {
      this._hintTimer = 0
      if (this._alive) this.setData({ switchHint: '' })
    }, SWITCH_HINT_MS)
  },

  async onCelebrateCert() {
    const id = this.endCelebrate()
    const app = getApp<IAppOption>()
    app.globalData.certFocusId = id
    app.globalData.homeWillReenter = true
    concealTabBar(this)
    wx.switchTab({ url: '/pages/certificate/index' })
    applyLesson(await this.takeNextPick(id))
  },

  // ===== 一炷香 =====

  onOpenIncense() {
    if (!INCENSE_ON) return
    if (this.entering() || this.overlayOn() || this._incense) return
    this.stopAuto()
    this.setData({ incenseSheetOn: true, incenseOptions: incenseOptions() })
    this.drawLessonTitle()
  },

  closeIncenseSheet() {
    if (!this.data.incenseSheetOn) return
    this.setData({ incenseSheetOn: false })
    this.drawLessonTitle()
    if (this.data.autoMode && !this.entering() && !this.overlayOn()) this.startAuto()
  },

  async onLightIncense(e: any) {
    const minutes = Number(e.currentTarget.dataset.minutes) || 0
    if (!minutes || this.data.incenseBusy) return
    this.setData({ incenseBusy: true })
    try {
      const res = await lightIncense(this._wishId, minutes)
      if (!this._alive) return
      this.setData({ incenseSheetOn: false, incenseBusy: false })
      this.drawLessonTitle()
      this.syncIncense(res.incense, res.incense.serverNow)
    } catch (err: any) {
      if (!this._alive) return
      this.setData({ incenseBusy: false })
      wx.showToast({ title: (err && err.message) || '点香失败', icon: 'none' })
    }
  },

  /** 按云端记录摆香：没有就收起；已燃尽就结算 */
  syncIncense(inc: { wishId: string | null; minutes: number; startMs: number } | null | undefined, serverNow?: number) {
    if (!this._alive) return
    if (typeof serverNow === 'number' && serverNow > 0) this._clockSkew = serverNow - Date.now()
    if (!INCENSE_ON || !inc || !inc.startMs || !inc.minutes) {
      if (this._incense) this.clearIncense()
      return
    }
    this._incense = {
      wishId: inc.wishId || null,
      minutes: inc.minutes,
      startMs: inc.startMs,
      endMs: inc.startMs + inc.minutes * 60000,
      serverNow: serverNow || 0,
    }
    this.stopAuto()
    this.setData({ incenseOn: true, incenseGain: inc.minutes * INCENSE_RATE })
    this.startIncenseTick()
  },

  startIncenseTick() {
    this.stopIncenseTick()
    this.incenseTick()
    this._incenseTimer = setInterval(() => this.incenseTick(), 1000) as unknown as number
  },

  stopIncenseTick() {
    if (this._incenseTimer) {
      clearInterval(this._incenseTimer)
      this._incenseTimer = 0
    }
  },

  incenseTick() {
    const inc = this._incense
    if (!this._alive || !inc) return
    const total = inc.endMs - inc.startMs
    const left = inc.endMs - (Date.now() + this._clockSkew)
    const burnt = Math.max(0, Math.min(1, 1 - left / total))
    const top = STICK_TOP + burnt * STICK_BURN
    this.setData({
      incenseLeft: clockText(left),
      incenseSink: Number(((top - PLUME_BASE) / 100).toFixed(4)),
      incenseTop: Number(top.toFixed(2)),
      incenseLen: Number((STICK_LEN - burnt * STICK_BURN).toFixed(2)),
    })
    if (left <= 0) this.settleIncense()
  },

  clearIncense() {
    this._incense = null
    this.stopIncenseTick()
    this.setData({ incenseOn: false, incenseLeft: '', incenseSink: 0, incenseTop: STICK_TOP, incenseLen: STICK_LEN })
    if (this.data.autoMode && !this.entering() && !this.overlayOn()) this.startAuto()
  },

  async settleIncense() {
    if (this._settling) return
    this._settling = true
    this.stopIncenseTick()
    try {
      const res = await settleIncense()
      if (!this._alive) return
      if (!res.settled) {
        // 云端还没燃尽（本机时钟快了）就接着等；香已不在就收起
        if (res.incense) this.syncIncense(res.incense, res.incense.serverNow)
        else this.clearIncense()
        return
      }
      this.clearIncense()
      vibrate(this.data.vibrateOn)
      this.spawnText('一炷香尽 · 专注 +' + (res.gained || 0), 'celebrate')
      if (typeof res.totalMerit === 'number') this.setData(this.levelPatch(res.totalMerit, res.todayCount))
      const w = res.wish
      if (w && res.wishId && res.wishId === this._wishId && this._lessonKind === 'wish') {
        this._titleCurrent = Math.max(0, Math.min(this._titleGoal, w.current || 0))
        this.applyTitleProgress()
        if (w.status === 'completed') this.celebrateWish()
      }
    } catch {
      // 网络不好：过几秒再试，香的记录在云端不会丢
      if (this._alive && this._incense) {
        setTimeout(() => {
          if (this._alive && this._incense) this.startIncenseTick()
        }, 5000)
      }
    } finally {
      this._settling = false
    }
  },

  onSnuffIncense() {
    const inc = this._incense
    if (!inc) return
    const burnt = Math.max(0, Math.floor((Date.now() + this._clockSkew - inc.startMs) / 60000))
    wx.showModal({
      title: '掐灭这炷香？',
      content: burnt > 0 ? '已燃 ' + burnt + ' 分钟，掐灭后不计入专注。' : '掐灭后不计入专注。',
      confirmText: '掐灭',
      cancelText: '再等等',
      success: (r) => {
        if (!r.confirm) return
        snuffIncense()
          .then(() => {
            if (this._alive) this.clearIncense()
          })
          .catch((err: any) => {
            wx.showToast({ title: (err && err.message) || '掐灭失败', icon: 'none' })
          })
      },
    })
  },

  noop() {},
})
