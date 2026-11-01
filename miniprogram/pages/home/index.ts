// 木鱼香案：选完今日功课后敲击；从其他 Tab 切回时播放短暗幕
import {
  fetchHome,
  fetchWishDetail,
  fetchWishes,
  UserRecord,
  settingsOf,
  bindChannelByScene,
  normalizeChannelScene,
} from '../../utils/cloud'
import { CHANTS, SESSION_MINUTES, SESSION_BEADS, levelOf } from '../../utils/constants'
import { playKnock, vibrate, vibrateLong, ensureKnock, ensureBell, playBell, KnockTimbre } from '../../utils/knock'
import { KnockQueue, TapSource } from '../../utils/knockQueue'
import { mockEnabled } from '../../utils/devMock'
import { concealTabBar, winInfo, fmtInt, dueText } from '../../utils/util'
import { DAWN_FILE_ID, resolveCloudFile } from '../../utils/cloudFile'
import { startAmbience, stopAmbience, fadeOutAmbience } from '../../utils/ambience'
import { AmbienceId } from '../../utils/audioCatalog'
import { parseTheme, themeEnds, ThemeId } from '../../utils/theme'
import { applyLesson, nextLesson, LessonPick, RANDOM_NAME, RANDOM_LESSON } from '../../utils/lesson'
import { SESSION_PLANS, SessionPlan, PlanId, planOf, triedPlans, markPlanTried } from '../../utils/sessionPlans'
import { buyPremium, PACK_NAME } from '../../utils/premium'
import { randomZen } from '../../utils/zen'
import { WISH_SUGGESTIONS } from '../../utils/wishIdeas'

interface FloatItem {
  key: number
  text: string
  left: number
  kind: 'score' | 'chant' | 'celebrate' | 'milestone'
}

type EnterPhase = 'cover' | 'reveal' | 'done'
type EnterKind = 'first' | 'back'

interface SheetRow {
  _id: string
  name: string
  mark: string
  cur: boolean
  /** 进度百分比，面板里每行底下一道细线 */
  pct: number
}

interface CelebrateInfo {
  name: string
  goalText: string
  thumbUrl: string
  /** 关掉弹窗后接着敲的功课，提前告诉用户 */
  nextText: string
}

const SWITCH_HINT_MS = 2600

// 定课：一炷香定时、一串念珠定数。木鱼照常敲，手敲 / 自动都算；只在香案前走时，结束响一声钟钵
type SessionKind = 'time' | 'count'

interface SessionOption {
  kind: SessionKind
  /** 分钟 / 下 */
  value: number
  /** 选项上的字：3 分钟 / 108 下 */
  label: string
}

interface SessionGroup {
  kind: SessionKind
  name: string
  mark: string
  options: SessionOption[]
}

interface PlanOption {
  id: PlanId
  name: string
  mark: string
  locked: boolean
  /** 右侧小签：免费 / 可试一次 / 静心包 */
  tag: string
}

interface SessionState {
  kind: SessionKind
  value: number
  /** 成品定课；自己选的一炷香 / 念珠为 null */
  plan: SessionPlan | null
  /** 没开静心包，在试这一套 */
  trial: boolean
  goalMs: number
  elapsedMs: number
  /** 上次走时的时刻，0 表示停着 */
  lastTick: number
  hand: number
  auto: number
}

interface SessionDone {
  kind: SessionKind
  value: number
  planId: PlanId | ''
  trial: boolean
  title: string
  line: string
  detail: string
  /** 成品定课的收尾语 */
  closing: string
  /** 试用结束时介绍静心包 */
  offer: string
}

/** 平时自动敲的间隔；成品定课按各自的节奏 */
const AUTO_GAP_MS = 800

/** 右下角香身图标的长度（rpx），定时时随燃烧变短 */
const STICK_ICON_LEN = 56

// 「自己敲」按一炷香 / 一串念珠分两行，时长和颗数做成小签，一眼看完不用往下翻
function sessionGroups(): SessionGroup[] {
  // 开发版本地多一个 1 分钟 / 10 下，方便看结束
  const mins = mockEnabled() ? [1].concat(SESSION_MINUTES) : SESSION_MINUTES
  const beads = mockEnabled() ? [10, SESSION_BEADS] : [SESSION_BEADS]
  return [
    {
      kind: 'time',
      name: '一炷香',
      mark: '到点即止',
      options: mins.map((m) => ({ kind: 'time' as SessionKind, value: m, label: m + ' 分钟' })),
    },
    {
      kind: 'count',
      name: '一串念珠',
      mark: '敲满即止',
      options: beads.map((n) => ({ kind: 'count' as SessionKind, value: n, label: n + ' 下' })),
    },
  ]
}

function planOptions(premium: boolean): PlanOption[] {
  const tried = triedPlans()
  return SESSION_PLANS.map((p) => {
    const locked = p.premium && !premium
    const mark = p.scene + ' · ' + p.minutes + ' 分钟'
    let tag = ''
    if (locked) tag = tried[p.id] ? PACK_NAME : '可试一次'
    return { id: p.id, name: p.name, mark, locked, tag }
  })
}

/** 成品定课的时长；开发版本地缩成 1 分钟，方便看收尾 */
function planMinutes(p: SessionPlan): number {
  return mockEnabled() ? 1 : p.minutes
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
/** 里程碑大字飘起后，这么久内不再出「专注 +1」小字 */
const MILESTONE_QUIET_MS = 1400
/** 换材质后色点旁的名字停留多久 */
const MAT_LABEL_MS = 1400

/** 今日叩数的整百、一百零八这些数，敲到时飘一句大字 */
function todayMilestone(n: number): string {
  if (n === 108) return '一百零八叩'
  if (n > 0 && n % 100 === 0) return '今日 ' + fmtInt(n) + ' 叩'
  return ''
}

function savedMaterial(): string {
  try {
    const v = wx.getStorageSync(MATERIAL_KEY)
    if (MATERIALS.some((m) => m.id === v)) return v
  } catch {
    // 用默认
  }
  return 'zitan'
}

function shareTitleOf(name: string, isWish: boolean): string {
  return isWish ? '我在为「' + name + '」轻叩木鱼，一起静一静' : '轻叩一声，万缘放下'
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
    headCurText: '0',
    headGoalText: '0',
    /** 心愿的期限：还剩 N 天 / 已过期限 */
    headDue: '',
    headLate: false,
    /** 今天还没敲过：木鱼周围一圈呼吸的光，提示轻触 */
    knockHint: false,
    /** 换材质时在色点旁边亮一下名字 */
    matLabel: '',
    matLabelOn: false,
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
    ideas: WISH_SUGGESTIONS.slice(0, 6),
    materials: MATERIALS,
    material: savedMaterial(),
    // 定课：进行中右下角显示剩余时间 / 已敲次数
    sessionOn: false,
    sessionKind: 'time' as SessionKind,
    sessionBig: '',
    sessionSmall: '',
    sessionStick: STICK_ICON_LEN,
    sessionSheetOn: false,
    sessionGroups: [] as SessionGroup[],
    planOptions: [] as PlanOption[],
    sessionDoneOn: false,
    sessionDone: null as SessionDone | null,
    /** 已开静心包 */
    premium: false,
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
  _session: null as SessionState | null,
  _sessionTimer: 0,
  /** 定课结束时正弹着圆满：等圆满关掉再给小结 */
  _pendingDone: null as SessionDone | null,
  // 自己在静心页选的氛围 / 主题；成品定课期间临时换成定课的，结束后换回来
  _userAmbience: 'off' as AmbienceId,
  _userTheme: 'dawn' as ThemeId,
  /** 当前铺着的成品定课场景：定课中，以及结束后小结还开着时 */
  _scenePlan: null as SessionPlan | null,
  /** 成品定课收尾后声音已淡出，小结关掉前不再响 */
  _sceneQuiet: false,
  /** 连续敲了几天（不含今天）；今天第一下时飘一句「连续第 N 天」 */
  _streak: 0,
  _matTimer: 0,
  /** 本次打开已飘过的整数里程碑，服务端回来的数偶尔会回退，别重复飘 */
  _milestones: {} as Record<string, 1>,
  _quietUntil: 0,
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
    this._userAmbience = cached.ambience
    this._userTheme = cached.theme
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
          wx.showToast({ title: '网络不稳 · 下一次敲击会一并补传', icon: 'none' })
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
    // 心愿圆满、定课收尾都要响钟钵，先把声音备好
    ensureBell()
    if (this._session) this.startSessionTick()
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
    } else if (this.data.sheetOn && app.globalData.newWishPicked) {
      // 从面板去立愿，新心愿已设成今日功课：收起面板，接着敲
      this.setData({ sheetFirst: false })
      this.closeSheet()
      this.showSwitchHint('新心愿已设为今日功课')
    } else if (this.data.sheetOn) {
      // 从面板去立愿后回来：刷新列表，新心愿就在里面
      this.loadSheet()
    }
    app.globalData.newWishPicked = false
  },

  onHide() {
    // 定课只在香案前走时：离开就停，回来接着走
    this.stopSessionTick()
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
    if (this._matTimer) clearTimeout(this._matTimer)
    this.stopSessionTick()
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
      headCurText: fmtInt(isWish ? this._titleCurrent : 0),
      headGoalText: fmtInt(isWish ? this._titleGoal : 0),
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
        const due = dueText(res.wish.deadline)
        this.setData(Object.assign(lessonTitlePatch(name), this.titleColorPatch(), { headDue: due.text, headLate: due.late }))
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
    this.setData(Object.assign(lessonTitlePatch(lessonTitleOf()), this.titleColorPatch(), { headDue: '', headLate: false }))
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
    // 竖排功课名用宋体，像经折上的字；没有宋体的机型退回系统字
    ctx.font = size.toFixed(1) + 'px "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", serif'
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
      // 今天还没敲时云端的连续天数不含今天；敲过了就含，先减掉，第一下再加回来
      this._streak = Math.max(0, (res.streak || 0) - (res.todayCount > 0 ? 1 : 0))
      this.applyHome(res.user, res.todayCount)
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
    this._userAmbience = s.ambience
    this._userTheme = s.theme
    const scene = this.sceneNow()
    this.setData(
      Object.assign(
        {
          loading: false,
          soundOn: s.soundOn,
          vibrateOn: s.vibrateOn,
          ambience: scene.ambience,
          theme: scene.theme,
          premium: user.premium === true,
          knockHint: todayCount === 0 && !this.data.strikeSeq,
        },
        this.levelPatch(user.totalMerit || 0, todayCount),
        scenePatch(this._titleCurrent, this._titleGoal, scene.theme)
      )
    )
    this.setData(this.titleColorPatch())
    this.drawLessonTitle()
    startAmbience(scene.ambience)
  },

  /** 此刻香案该用的声音和主题：成品定课铺着时用定课的，否则用自己的设置 */
  sceneNow(): { ambience: AmbienceId; theme: ThemeId } {
    const plan = this._scenePlan
    if (!plan) return { ambience: this._userAmbience, theme: this._userTheme }
    return { ambience: this._sceneQuiet ? 'off' : plan.ambience, theme: plan.theme }
  },

  applyScene() {
    const scene = this.sceneNow()
    this.setData({ ambience: scene.ambience, theme: scene.theme })
    this.setData(this.titleColorPatch())
    this.drawLessonTitle()
    startAmbience(scene.ambience)
  },

  /** 收起成品定课的场景，换回自己的声音和主题 */
  restoreScene() {
    if (!this._scenePlan) return
    this._scenePlan = null
    this._sceneQuiet = false
    this.applyScene()
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
    this.setData({ material: m.id, matLabel: m.name, matLabelOn: true })
    try {
      wx.setStorageSync(MATERIAL_KEY, m.id)
    } catch {
      // 下次启动回到默认材质
    }
    vibrate(this.data.vibrateOn, 'light')
    if (this._matTimer) clearTimeout(this._matTimer)
    this._matTimer = setTimeout(() => {
      this._matTimer = 0
      if (this._alive) this.setData({ matLabelOn: false })
    }, MAT_LABEL_MS) as unknown as number
  },

  knock(source: TapSource) {
    if (!this._alive || this.entering() || !this.data.readyToKnock || this.overlayOn()) return
    const d = this.data
    playKnock(d.soundOn, this.knockTimbre())
    vibrate(d.vibrateOn, source === 'auto' ? 'light' : 'heavy')
    const nextTotal = d.totalMerit + 1
    const nextToday = d.todayCount + 1
    const prevCur = this._titleCurrent
    const milestone = this.milestoneOf(nextTotal, nextToday, prevCur)
    let floats: FloatItem[] | null = null
    if (milestone) {
      floats = this.pushFloat(milestone, 'milestone')
      this._quietUntil = Date.now() + MILESTONE_QUIET_MS
    } else if (Date.now() > this._quietUntil) {
      // 大字还在飘时不再出小字，免得叠在一起
      const f = this.pickFloat()
      floats = this.pushFloat(f.text, f.kind)
    }

    this._titleCurrent = Math.min(this._titleGoal, this._titleCurrent + 1)
    if (this._lessonKind === 'random') this._randomHits = this._titleCurrent
    // 飘字、回弹、涟漪和数字并成一次 setData，连敲时少走几趟渲染层
    const patch: Record<string, any> = Object.assign(this.levelPatch(nextTotal, nextToday), this.titleColorPatch(), {
      strikeSeq: d.strikeSeq + 1,
      knockHint: false,
      pulsing: false,
      rippleOn: false,
    })
    if (floats) patch.floats = floats
    this.setData(patch)
    this.replayStrikeFx()
    this.drawLessonTitle()
    if (this._queue) this._queue.tap(source)
    this.countSession(source)
  },

  /**
   * 这一下是不是值得飘一句大字：今天第一下、整百、一百零八、心愿过半、升了称号。
   * 同一句本次打开只飘一次
   */
  milestoneOf(nextTotal: number, nextToday: number, prevCur: number): string {
    let text = ''
    const before = levelOf(nextTotal - 1)
    const after = levelOf(nextTotal)
    if (after.level > before.level) text = '晋 · ' + after.title
    // 今日叩数还没从云端拉回来时别急着说「第一叩」
    else if (nextToday === 1 && !this.data.loading) text = this._streak > 0 ? '连续第 ' + (this._streak + 1) + ' 天' : '今日第一叩'
    else if (todayMilestone(nextToday)) text = todayMilestone(nextToday)
    else if (this._lessonKind === 'wish' && this._titleGoal >= 20) {
      const half = Math.ceil(this._titleGoal / 2)
      if (prevCur < half && prevCur + 1 >= half && prevCur + 1 < this._titleGoal) text = '心愿过半'
    }
    if (!text) return ''
    const key = text + '@' + (text === '心愿过半' ? this._wishId : '')
    if (this._milestones[key]) return ''
    this._milestones[key] = 1
    return text
  },

  /** 右下角「自动」开关：随时切换，不存云端 */
  onToggleAuto() {
    if (this.entering() || this.overlayOn()) return
    const on = !this.data.autoMode
    this.setData({ autoMode: on })
    if (on) this.startAuto()
    else this.stopAuto()
  },

  startAuto() {
    if (this._autoTimer || this.entering()) return
    this.scheduleAuto()
  },

  // 每一下都重新算间隔：成品定课的节奏会随进度变慢
  scheduleAuto() {
    this._autoTimer = setTimeout(() => {
      if (!this._alive) {
        this._autoTimer = 0
        return
      }
      this.knock('auto')
      // 这一下可能刚好结束了定课并停掉自动敲
      if (this._autoTimer) this.scheduleAuto()
    }, this.autoGap()) as unknown as number
  },

  stopAuto() {
    if (this._autoTimer) {
      clearTimeout(this._autoTimer)
      this._autoTimer = 0
    }
  },

  autoGap(): number {
    const s = this._session
    const plan = s && s.plan
    if (!s || !plan) return AUTO_GAP_MS
    const t = s.kind === 'time' ? s.elapsedMs / s.goalMs : (s.hand + s.auto) / s.value
    const k = Math.max(0, Math.min(1, t))
    return Math.round(plan.gapFrom + (plan.gapTo - plan.gapFrom) * k)
  },

  knockTimbre(): KnockTimbre {
    const plan = this._session && this._session.plan
    return plan ? plan.timbre : 'default'
  },

  pickFloat(): { text: string; kind: FloatItem['kind'] } {
    if (Math.random() < 0.55) return { text: '专注 +1', kind: 'score' }
    return { text: CHANTS[Math.floor(Math.random() * CHANTS.length)], kind: 'chant' }
  },

  /** 加一条飘字，返回新的列表交给调用方一并 setData；到时自己摘掉 */
  pushFloat(text: string, kind: FloatItem['kind']): FloatItem[] {
    this._floatSeq += 1
    const floats = this.data.floats.slice()
    if (floats.length > 5) floats.shift()
    const big = kind === 'celebrate' || kind === 'milestone'
    floats.push({
      key: this._floatSeq,
      text,
      left: big ? 50 : 30 + Math.random() * 40,
      kind,
    })
    const key = this._floatSeq
    setTimeout(
      () => {
        if (!this._alive) return
        this.setData({ floats: this.data.floats.filter((f) => f.key !== key) })
      },
      big ? 2400 : 1000
    )
    return floats
  },

  /** pulsing / rippleOn 已随这一下复位，下一帧再点亮，CSS 动画就会从头播 */
  replayStrikeFx() {
    wx.nextTick(() => {
      if (this._alive) this.setData({ pulsing: true, rippleOn: true })
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
    return this.data.celebrateOn || this.data.sheetOn || this.data.sessionSheetOn || this.data.sessionDoneOn
  },

  onOpenLessonPanel() {
    if (this.entering() || this.overlayOn()) return
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
          mark: fmtInt(w.current) + ' / ' + fmtInt(w.goal),
          cur: w._id === curId,
          pct: w.goal > 0 ? Math.min(100, Math.round((w.current / w.goal) * 100)) : 0,
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

  onSheetIdea(e: any) {
    const name = String(e.currentTarget.dataset.name || '')
    wx.navigateTo({ url: '/pages/wish-form/index?name=' + encodeURIComponent(name) })
  },

  /** 心愿敲满：停住敲击，弹出圆满；关掉时再切到下一个心愿 */
  celebrateWish() {
    const id = this._wishId
    if (!id || this._celebrateId) return
    this._celebrateId = id
    this._wishId = null
    this.stopAuto()
    // 圆满这一下要有分量：钟钵一声，长震一下
    playBell(this.data.soundOn)
    vibrateLong(this.data.vibrateOn)
    if (this.data.sessionDone) {
      // 敲满念珠的同一下圆满了心愿：先庆圆满，小结等会儿再给
      this._pendingDone = this.data.sessionDone
      this.setData({ sessionDoneOn: false, sessionDone: null })
    }
    this.setData({
      celebrateOn: true,
      celebrate: {
        name: this.data.lessonTitle || '心愿',
        goalText: '专注 ' + fmtInt(this._titleGoal),
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
        if (!this._alive || this._celebrateId !== id || !this.data.celebrate) return
        const patch: Record<string, string> = {}
        const thumbUrl = (res.wish && res.wish.thumbUrl) || ''
        if (thumbUrl) patch['celebrate.thumbUrl'] = thumbUrl
        // 立愿到圆满走了几天
        const born = res.wish ? new Date(res.wish.createdAt as any).getTime() : NaN
        if (born > 0) {
          const days = Math.max(1, Math.ceil((Date.now() - born) / 86400000))
          patch['celebrate.goalText'] = '历时 ' + days + ' 天 · 专注 ' + fmtInt(this._titleGoal)
        }
        if (Object.keys(patch).length) this.setData(patch)
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
    if (this._pendingDone) {
      this.showSessionDone(this._pendingDone)
      this._pendingDone = null
    }
    if (this.data.autoMode && !this.entering() && !this.overlayOn()) this.startAuto()
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
    this._pendingDone = null
    this.restoreScene()
    const app = getApp<IAppOption>()
    app.globalData.certFocusId = id
    app.globalData.homeWillReenter = true
    concealTabBar(this)
    wx.switchTab({ url: '/pages/certificate/index' })
    applyLesson(await this.takeNextPick(id))
  },

  // ===== 定课 =====

  onOpenSession() {
    if (this.entering() || this.overlayOn() || this._session) return
    this.stopAuto()
    ensureBell()
    this.setData({
      sessionSheetOn: true,
      sessionGroups: sessionGroups(),
      planOptions: planOptions(this.data.premium),
    })
    this.drawLessonTitle()
  },

  closeSessionSheet() {
    if (!this.data.sessionSheetOn) return
    this.setData({ sessionSheetOn: false })
    this.drawLessonTitle()
    if (this.data.autoMode && !this.entering() && !this.overlayOn()) this.startAuto()
  },

  onPickSession(e: any) {
    const kind = e.currentTarget.dataset.kind
    const value = Number(e.currentTarget.dataset.value) || 0
    if (!value || (kind !== 'time' && kind !== 'count')) return
    this.setData({ sessionSheetOn: false })
    this.drawLessonTitle()
    this.beginSession(kind, value)
  },

  /** 成品定课：免费的直接开始；静心包的没开过先试一次，试过了再点就去开启 */
  async onPickPlan(e: any) {
    const plan = planOf(String(e.currentTarget.dataset.id || ''))
    if (!plan) return
    if (!plan.premium || this.data.premium) {
      this.startPlan(plan, false)
      return
    }
    if (!triedPlans()[plan.id]) {
      this.startPlan(plan, true)
      return
    }
    const r = await buyPremium(() => this._alive)
    if (!this._alive) return
    if (r === 'opened') {
      this.setData({ premium: true })
      wx.showToast({ title: PACK_NAME + '已开启', icon: 'none' })
      this.startPlan(plan, false)
    } else if (r === 'pending') {
      wx.showToast({ title: '付款已收到，正在开启', icon: 'none' })
    }
  },

  startPlan(plan: SessionPlan, trial: boolean) {
    this.setData({ sessionSheetOn: false })
    this.drawLessonTitle()
    if (trial) wx.showToast({ title: '试一次 · 走完这一段', icon: 'none' })
    this.beginSession('time', planMinutes(plan), plan, trial)
  },

  beginSession(kind: SessionKind, value: number, plan: SessionPlan | null = null, trial = false) {
    this._session = {
      kind,
      value,
      plan,
      trial,
      goalMs: kind === 'time' ? value * 60000 : 0,
      elapsedMs: 0,
      lastTick: 0,
      hand: 0,
      auto: 0,
    }
    if (plan) {
      ensureKnock(plan.timbre)
      this._scenePlan = plan
      this._sceneQuiet = false
      this.applyScene()
    } else {
      this.restoreScene()
    }
    this.setData(Object.assign({ sessionOn: true, sessionKind: kind }, this.sessionPatch()))
    this.startSessionTick()
    if (this.data.autoMode && !this.entering() && !this.overlayOn()) this.startAuto()
  },

  sessionPatch(): { sessionBig: string; sessionSmall: string; sessionStick: number } {
    const s = this._session
    if (!s) return { sessionBig: '', sessionSmall: '', sessionStick: STICK_ICON_LEN }
    const n = s.hand + s.auto
    if (s.kind === 'count') return { sessionBig: String(n), sessionSmall: '/ ' + s.value, sessionStick: STICK_ICON_LEN }
    const burnt = Math.max(0, Math.min(1, s.elapsedMs / s.goalMs))
    return {
      sessionBig: clockText(s.goalMs - s.elapsedMs),
      sessionSmall: '已敲 ' + n,
      sessionStick: Math.max(4, Math.round(STICK_ICON_LEN * (1 - burnt))),
    }
  },

  startSessionTick() {
    this.stopSessionTick()
    const s = this._session
    if (!s || s.kind !== 'time') return
    s.lastTick = Date.now()
    this._sessionTimer = setInterval(() => this.sessionTick(), 500) as unknown as number
  },

  stopSessionTick() {
    if (this._sessionTimer) {
      clearInterval(this._sessionTimer)
      this._sessionTimer = 0
    }
    if (this._session) this._session.lastTick = 0
  },

  sessionTick() {
    const s = this._session
    if (!this._alive || !s) return
    const now = Date.now()
    // 面板、弹窗盖着或正在入堂时不走；一次最多走 2 秒，机器休眠回来不会一下跳过去
    if (s.lastTick && !this.overlayOn() && !this.entering()) {
      s.elapsedMs += Math.min(2000, Math.max(0, now - s.lastTick))
    }
    s.lastTick = now
    if (s.elapsedMs >= s.goalMs) {
      this.finishSession()
      return
    }
    const p = this.sessionPatch()
    if (p.sessionBig !== this.data.sessionBig || p.sessionStick !== this.data.sessionStick) this.setData(p)
  },

  countSession(source: TapSource) {
    const s = this._session
    if (!s) return
    s[source] += 1
    if (s.kind === 'count' && s.hand + s.auto >= s.value) {
      this.finishSession()
      return
    }
    this.setData(this.sessionPatch())
  },

  endSession() {
    this.stopSessionTick()
    this._session = null
    this.setData({ sessionOn: false })
  },

  /** 时间到 / 念珠满：停下自动敲；成品定课先让声音淡出，再响一声钟钵，给小结 */
  finishSession() {
    const s = this._session
    if (!s) return
    this.endSession()
    this.stopAuto()
    this.setData({ autoMode: false })
    const plan = s.plan
    if (plan && s.trial) markPlanTried(plan.id)
    const n = s.hand + s.auto
    const parts: string[] = []
    if (s.kind === 'time') parts.push(s.value + ' 分钟')
    if (s.hand) parts.push('手敲 ' + s.hand)
    if (s.auto) parts.push('自动 ' + s.auto)
    if (this.data.todayCount > 0) parts.push('今日共 ' + fmtInt(this.data.todayCount))
    const info: SessionDone = {
      kind: s.kind,
      value: s.value,
      planId: plan ? plan.id : '',
      trial: s.trial,
      title: plan ? plan.name : s.kind === 'time' ? '一炷香尽' : '念珠一串',
      line: s.kind === 'time' ? '敲了 ' + n + ' 下' : n + ' 下圆满',
      detail: parts.join(' · '),
      // 自己敲的没有配好的收尾语，送一句
      closing: plan ? plan.closing : randomZen().text,
      offer: plan && s.trial ? '这是' + PACK_NAME + '里的一套定课，开启后随时可用' : '',
    }
    const ring = () => {
      playBell(this.data.soundOn)
      vibrateLong(this.data.vibrateOn)
      this.showSessionDone(info)
    }
    if (!plan) {
      ring()
      return
    }
    this._sceneQuiet = true
    this.setData({ ambience: 'off' })
    fadeOutAmbience(plan.fadeMs).then(() => {
      if (this._alive) ring()
    })
  },

  showSessionDone(info: SessionDone) {
    if (this.data.celebrateOn) {
      this._pendingDone = info
      return
    }
    this.stopAuto()
    this.setData({ sessionDoneOn: true, sessionDone: info })
    this.drawLessonTitle()
  },

  closeSessionDone(): SessionDone | null {
    const info = this.data.sessionDone
    this.setData({ sessionDoneOn: false, sessionDone: null })
    this.drawLessonTitle()
    return info
  },

  onSessionDoneClose() {
    this.closeSessionDone()
    this.restoreScene()
  },

  onSessionAgain() {
    const info = this.closeSessionDone()
    if (!info) return
    const plan = info.planId ? planOf(info.planId) : null
    if (plan) this.beginSession('time', planMinutes(plan), plan, false)
    else this.beginSession(info.kind, info.value)
  },

  /** 试用结束的小结里直接开启；开了就接着用刚才这套 */
  async onSessionBuy() {
    const info = this.closeSessionDone()
    const plan = info && info.planId ? planOf(info.planId) : null
    const r = await buyPremium(() => this._alive)
    if (!this._alive) return
    if (r === 'opened') {
      this.setData({ premium: true })
      wx.showToast({ title: PACK_NAME + '已开启', icon: 'none' })
      if (plan) {
        this.beginSession('time', planMinutes(plan), plan, false)
        return
      }
    } else if (r === 'pending') {
      wx.showToast({ title: '付款已收到，正在开启', icon: 'none' })
    }
    this.restoreScene()
  },

  /** 提前收起：已敲的早已计入，收起只是不再计时 / 计数 */
  onEndSession() {
    const s = this._session
    if (!s) return
    const n = s.hand + s.auto
    wx.showModal({
      title: s.kind === 'time' ? '提前收起这炷香？' : '提前收起念珠？',
      content:
        (n > 0 ? '已敲 ' + n + ' 下，都已计入专注。' : '收起后回到自由敲击。') +
        (s.plan && s.trial ? '这次试用也就用过了。' : ''),
      confirmText: '收起',
      cancelText: '接着敲',
      success: (r) => {
        if (!r.confirm || !this._alive || this._session !== s) return
        if (s.plan && s.trial) markPlanTried(s.plan.id)
        this.endSession()
        this.restoreScene()
      },
    })
  },

  onShareAppMessage() {
    const isWish = getApp<IAppOption>().globalData.knockMode === 'wish'
    return { title: shareTitleOf(this.data.lessonTitle, isWish), path: '/pages/gate/index' }
  },

  onShareTimeline() {
    return { title: '小叩木鱼 · 轻叩一声，万缘放下' }
  },

  noop() {},
})
