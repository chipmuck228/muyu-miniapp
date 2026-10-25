// 木鱼香案：选完今日功课后敲击；从其他 Tab 切回时播放短暗幕
import { fetchHome, fetchWishDetail, UserRecord, settingsOf, bindChannelByScene, normalizeChannelScene } from '../../utils/cloud'
import { CHANTS } from '../../utils/constants'
import { playKnock, vibrate, ensureKnock } from '../../utils/knock'
import { KnockQueue } from '../../utils/knockQueue'
import { concealTabBar, winInfo } from '../../utils/util'
import { DAWN_FILE_ID, resolveCloudFile } from '../../utils/cloudFile'
import { startAmbience, stopAmbience } from '../../utils/ambience'
import { AmbienceId } from '../../utils/audioCatalog'
import { parseTheme, themeEnds, ThemeId } from '../../utils/theme'
import { applyLesson, nextLesson, LessonPick, RANDOM_NAME } from '../../utils/lesson'

interface FloatItem {
  key: number
  text: string
  left: number
  kind: 'score' | 'chant' | 'celebrate'
}

type EnterPhase = 'cover' | 'reveal' | 'done'
type EnterKind = 'first' | 'back'

interface CelebrateInfo {
  name: string
  goalText: string
  thumbUrl: string
}

function bindWishId(): string | null {
  const app = getApp<IAppOption>()
  if (app.globalData.knockMode === 'wish') return app.globalData.knockWishId || null
  return null
}

const LESSON_TITLE_MAX = 8
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
  },

  _floatSeq: 0,
  _pulseTimer: 0,
  _autoTimer: 0,
  _enterTimer: 0,
  _queue: null as KnockQueue | null,
  _wishId: null as string | null,
  _alive: false,
  _hasEntered: false,
  _openingLesson: false,
  _titleTimer: 0,
  _titleCurrent: 0,
  _titleGoal: RANDOM_GOAL,
  _randomHits: 0,
  _lessonKind: '' as '' | 'wish' | 'random',
  _titleCanvas: null as any,
  _titleCtx: null as any,
  _titleCssW: 0,
  _titleCssH: 0,
  _celebrateId: '' as string,
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
      this.openLesson()
      return
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
    this.refresh()
    this.tryEnter()
  },

  onHide() {
    this.stopAuto()
    stopAmbience()
    this.clearEnterTimer()
    this.clearTitleTimer()
    this._titleCtx = null
    this._titleCanvas = null
    this._titleCssW = 0
    this._titleCssH = 0
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
    this.stopAuto()
    stopAmbience()
    this.clearEnterTimer()
    this.clearTitleTimer()
    if (this._queue) {
      this._queue.destroy()
      this._queue = null
    }
  },

  openLesson(fromHome?: boolean) {
    if (this._openingLesson) return
    this._openingLesson = true
    wx.navigateTo({
      url: '/pages/lesson/index' + (fromHome ? '?from=home' : ''),
      complete: () => {
        this._openingLesson = false
      },
    })
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
        if (this.data.autoMode && !this.data.celebrateOn) this.startAuto()
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
    if (!this.data.lessonTitleOn || this.data.celebrateOn || !chars.length) return
    ctx.fillStyle = this.data.lessonColor || mixTitleColor(this._titleCurrent, this._titleGoal, parseTheme(this.data.theme))
    ctx.font = '15px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const line = 22
    const total = chars.length * line
    let y = (h - total) / 2 + line / 2
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], w / 2, y)
      y += line
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
          autoMode: s.autoMode,
          ambience: s.ambience,
          theme: s.theme,
        },
        this.levelPatch(user.totalMerit || 0, todayCount),
        scenePatch(this._titleCurrent, this._titleGoal, s.theme)
      )
    )
    this.setData(this.titleColorPatch())
    this.drawLessonTitle()
    if (s.autoMode && !this.entering() && !this.data.celebrateOn) this.startAuto()
    else if (!s.autoMode) this.stopAuto()
    startAmbience(s.ambience)
  },

  onKnockTap() {
    this.knock()
  },

  knock() {
    if (!this._alive || this.entering() || !this.data.readyToKnock || this.data.celebrateOn) return
    const d = this.data
    playKnock(d.soundOn)
    vibrate(d.vibrateOn)
    this.spawnFloat()
    this.pulse()
    this.ripple()

    const nextTotal = d.totalMerit + 1
    this._titleCurrent = Math.min(this._titleGoal, this._titleCurrent + 1)
    if (this._lessonKind === 'random') this._randomHits = this._titleCurrent
    this.setData(Object.assign(this.levelPatch(nextTotal, d.todayCount + 1), this.titleColorPatch()))
    this.drawLessonTitle()
    if (this._queue) this._queue.tap(1)
  },

  startAuto() {
    if (this._autoTimer || this.entering()) return
    this._autoTimer = setInterval(() => {
      if (this._alive) this.knock()
    }, 800)
  },
  stopAuto() {
    if (this._autoTimer) {
      clearInterval(this._autoTimer)
      this._autoTimer = 0
    }
  },

  spawnFloat() {
    const texts: string[] = []
    if (Math.random() < 0.55) {
      texts.push('专注 +1')
    } else {
      texts.push(CHANTS[Math.floor(Math.random() * CHANTS.length)])
    }
    this._floatSeq += 1
    const floats = this.data.floats.slice()
    if (floats.length > 5) floats.shift()
    floats.push({
      key: this._floatSeq,
      text: texts[0],
      left: 26 + Math.random() * 44,
      kind: texts[0].indexOf('+') >= 0 ? 'score' : 'chant',
    })
    this.setData({ floats })
    const key = this._floatSeq
    setTimeout(() => {
      if (!this._alive) return
      this.setData({ floats: this.data.floats.filter((f) => f.key !== key) })
    }, 1000)
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

  onOpenLessonPanel() {
    if (this.entering() || this.data.celebrateOn) return
    this.openLesson(true)
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
      },
    })
    this.drawLessonTitle()
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

  async onCelebrateContinue() {
    const id = this.endCelebrate()
    this.switchLesson(await nextLesson(id))
    if (this.data.autoMode && !this.entering()) this.startAuto()
  },

  async onCelebrateCert() {
    const id = this.endCelebrate()
    const app = getApp<IAppOption>()
    app.globalData.certFocusId = id
    app.globalData.homeWillReenter = true
    concealTabBar(this)
    wx.switchTab({ url: '/pages/certificate/index' })
    applyLesson(await nextLesson(id))
  },

  noop() {},
})
