// 木鱼香案：选完今日功课后敲击；从其他 Tab 切回时播放短暗幕
import { fetchHome, fetchWishDetail, UserRecord, settingsOf, bindChannelByScene, normalizeChannelScene } from '../../utils/cloud'
import { CHANTS } from '../../utils/constants'
import { playKnock, vibrate, ensureKnock } from '../../utils/knock'
import { KnockQueue } from '../../utils/knockQueue'
import { concealTabBar, winInfo } from '../../utils/util'
import { DAWN_FILE_ID, resolveCloudFile } from '../../utils/cloudFile'
import { startAmbience, stopAmbience } from '../../utils/ambience'
import { AmbienceId } from '../../utils/audioCatalog'

interface FloatItem {
  key: number
  text: string
  left: number
  kind: 'score' | 'chant' | 'celebrate'
}

type EnterPhase = 'cover' | 'reveal' | 'done'
type EnterKind = 'first' | 'back'

function bindWishId(): string | null {
  const app = getApp<IAppOption>()
  if (app.globalData.knockMode === 'wish') return app.globalData.knockWishId || null
  return null
}

const LESSON_TITLE_MAX = 8
const RANDOM_GOAL = 10
const TITLE_WHITE = { r: 255, g: 255, b: 255 }
const TITLE_GOLD = { r: 232, g: 201, b: 138 }

function progressT(cur: number, goal: number): number {
  return goal > 0 ? Math.max(0, Math.min(1, cur / goal)) : 0
}

function mixTitleColor(cur: number, goal: number): string {
  const t = progressT(cur, goal)
  const r = Math.round(TITLE_WHITE.r + (TITLE_GOLD.r - TITLE_WHITE.r) * t)
  const g = Math.round(TITLE_WHITE.g + (TITLE_GOLD.g - TITLE_WHITE.g) * t)
  const b = Math.round(TITLE_WHITE.b + (TITLE_GOLD.b - TITLE_WHITE.b) * t)
  return 'rgb(' + r + ',' + g + ',' + b + ')'
}

function scenePatch(cur: number, goal: number) {
  const t = progressT(cur, goal)
  return {
    lessonColor: mixTitleColor(cur, goal),
    dawnSky: Number(t.toFixed(3)),
    smokeFade: Number((1 - t * 0.92).toFixed(3)),
  }
}

function lessonTitleOf(): string {
  const app = getApp<IAppOption>()
  if (app.globalData.knockMode === 'wish' && app.globalData.knockWishId) {
    return app.globalData.knockWishName || '心愿'
  }
  return '随机专注'
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
    floats: [] as FloatItem[],
    rippleOn: false,
    pulsing: false,
    enterPhase: 'done' as EnterPhase,
    enterKind: 'first' as EnterKind,
    lessonTitle: '',
    lessonChars: [] as string[],
    lessonTitleOn: false,
    lessonColor: mixTitleColor(0, 1),
    dawnSky: 0,
    smokeFade: 1,
    dawnSrc: '',
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
  onLoad(options: Record<string, string | undefined>) {
    const app = getApp<IAppOption>()
    const scene =
      normalizeChannelScene(String((options && (options.scene || options.ch)) || '')) ||
      normalizeChannelScene(String(app.globalData.pendingChannelScene || ''))
    if (scene) {
      app.globalData.pendingChannelScene = scene
      bindChannelByScene(scene).catch(() => {})
    }
    this.setData(
      Object.assign(
        {
          statusBarHeight: app.globalData.statusBarHeight || 20,
          readyToKnock: !!app.globalData.lessonChosen,
        },
        app.globalData.lessonChosen ? lessonTitlePatch(lessonTitleOf()) : {}
      )
    )
    this._alive = true
    this._queue = new KnockQueue(
      () => this._wishId,
      (r) => {
        if (!this._alive) return
        if (r.completed) {
          this._wishId = null
          app.globalData.knockWishId = null
          app.globalData.knockMode = 'random'
          app.globalData.knockWishName = '随机专注'
          this._lessonKind = 'random'
          this._randomHits = 0
          this._titleCurrent = 0
          this._titleGoal = RANDOM_GOAL
          this.setData(
            Object.assign(lessonTitlePatch('随机专注'), { lessonTitleOn: true }, scenePatch(0, RANDOM_GOAL))
          )
          this.drawLessonTitle()
          wx.showToast({ title: '心愿已成 · 惊喜已启', icon: 'none' })
        }
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
    this._wishId = bindWishId()
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

  openLesson() {
    if (this._openingLesson) return
    this._openingLesson = true
    wx.navigateTo({
      url: '/pages/lesson/index',
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
        if (this.data.autoMode) this.startAuto()
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
    return scenePatch(this._titleCurrent, this._titleGoal)
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
      this._lessonKind = 'wish'
      try {
        const res = await fetchWishDetail(id)
        if (!this._alive || !res.wish) return
        const name = res.wish.name || '心愿'
        app.globalData.knockWishName = name
        this._titleGoal = Math.max(1, res.wish.goal || 1)
        this._titleCurrent = Math.max(0, Math.min(this._titleGoal, res.wish.current || 0))
        this.setData(Object.assign(lessonTitlePatch(name), this.titleColorPatch()))
        this.drawLessonTitle()
      } catch {
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
    if (!this.data.lessonTitleOn || !chars.length) return
    ctx.fillStyle = this.data.lessonColor || mixTitleColor(this._titleCurrent, this._titleGoal)
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
        },
        this.levelPatch(user.totalMerit || 0, todayCount)
      )
    )
    if (s.autoMode && !this.entering()) this.startAuto()
    else if (!s.autoMode) this.stopAuto()
    startAmbience(s.ambience)
  },

  onKnockTap() {
    this.knock()
  },

  knock() {
    if (!this._alive || this.entering() || !this.data.readyToKnock) return
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

  noop() {},
})
