// 入堂页：冷启动仪式。轻触随时打断。
// 首次打开：约 4s 后入今日功课；之后再打开：只闪一下，直接回香案接着上次的心愿。
import { applyLesson, loadLesson, LessonPick } from '../../utils/lesson'

const AUTO_ENTER_MS = 4000
const RETURN_ENTER_MS = 700
const LEAVE_FADE_MS = 680

Page({
  data: {
    leaving: false,
  },

  _timer: 0,
  _leaving: false,
  _last: null as LessonPick | null,

  onLoad() {
    this._last = loadLesson()
    this._timer = setTimeout(() => {
      this.enterHall()
    }, this._last ? RETURN_ENTER_MS : AUTO_ENTER_MS)
  },

  onUnload() {
    this.clearTimer()
  },

  noop() {},

  onEnter() {
    this.enterHall()
  },

  clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = 0
    }
  },

  enterHall() {
    if (this._leaving) return
    this._leaving = true
    this.clearTimer()
    const app = getApp<IAppOption>()
    app.globalData.fromGate = true
    const last = this._last
    if (last) applyLesson(last)
    this.setData({ leaving: true })
    setTimeout(() => {
      if (last) wx.switchTab({ url: '/pages/home/index' })
      else wx.redirectTo({ url: '/pages/lesson/index' })
    }, LEAVE_FADE_MS)
  },
})
