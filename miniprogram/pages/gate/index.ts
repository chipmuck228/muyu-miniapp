// 入堂页（已定稿）：冷启动仪式。轻触随时打断；无操作约 4s 后入今日功课。
const AUTO_ENTER_MS = 4000
const LEAVE_FADE_MS = 680

Page({
  data: {
    leaving: false,
  },

  _timer: 0,
  _leaving: false,

  onLoad() {
    this._timer = setTimeout(() => {
      this.enterHall()
    }, AUTO_ENTER_MS)
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
    this.setData({ leaving: true })
    setTimeout(() => {
      wx.redirectTo({ url: '/pages/lesson/index' })
    }, LEAVE_FADE_MS)
  },
})
