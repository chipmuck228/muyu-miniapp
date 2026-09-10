// 木鱼香案：选完今日功课后敲击；从其他 Tab 切回时播放短暗幕
import { fetchHome, UserRecord } from '../../utils/cloud'
import { CHANTS } from '../../utils/constants'
import { playKnock, vibrate } from '../../utils/knock'
import { KnockQueue } from '../../utils/knockQueue'
import { concealTabBar } from '../../utils/util'

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
    floats: [] as FloatItem[],
    rippleOn: false,
    pulsing: false,
    enterPhase: 'done' as EnterPhase,
    enterKind: 'first' as EnterKind,
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
  onLoad() {
    const app = getApp<IAppOption>()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      readyToKnock: !!app.globalData.lessonChosen,
    })
    this._alive = true
    this._queue = new KnockQueue(
      () => this._wishId,
      (r) => {
        if (!this._alive) return
        if (r.completed) {
          this._wishId = null
          app.globalData.knockWishId = null
          wx.showToast({ title: '心愿圆满，随喜赞叹', icon: 'none' })
        }
        this.setData(this.levelPatch(r.totalMerit, r.todayCount))
      },
      () => {
        if (this._alive) {
          wx.showToast({ title: '功德未能上传，请重试', icon: 'none' })
        }
      }
    )
  },

  onShow() {
    const app = getApp<IAppOption>()
    if (!app.globalData.lessonChosen) {
      this.openLesson()
      return
    }
    this._wishId = bindWishId()
    this.setData({ readyToKnock: true })
    concealTabBar(this)
    this.refresh()
    this.tryEnter()
  },

  onHide() {
    this.stopAuto()
    this.clearEnterTimer()
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
    this.clearEnterTimer()
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
    const autoMode = !!(user.settings && user.settings.autoMode)
    this.setData(
      Object.assign(
        {
          loading: false,
          soundOn: !!(user.settings && user.settings.soundOn),
          vibrateOn: !!(user.settings && user.settings.vibrateOn),
          autoMode,
        },
        this.levelPatch(user.totalMerit || 0, todayCount)
      )
    )
    if (autoMode && !this.entering()) this.startAuto()
    else if (!autoMode) this.stopAuto()
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
    this.setData(this.levelPatch(nextTotal, d.todayCount + 1))
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
      texts.push('功德 +1')
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
