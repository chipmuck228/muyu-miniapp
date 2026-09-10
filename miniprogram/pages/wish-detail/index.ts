// 心愿详情
import { fetchWishDetail, fulfillWish, Wish, settingsOf } from '../../utils/cloud'
import { STATUS_TEXT, STATUS_CLS, percentOf } from '../../utils/constants'
import { setFormState } from '../../utils/formState'
import { fmtMD, todayStr, offsetDate, fmtInt, winInfo } from '../../utils/util'
import { playKnock, vibrate } from '../../utils/knock'
import { KnockQueue } from '../../utils/knockQueue'

interface BarItem {
  key: string
  label: string
  count: number
  ratio: number
  isToday: boolean
  hasValue: boolean
}

interface RecordVM {
  date: string
  text: string
  count: number
}

interface WishVM {
  _id: string
  name: string
  goal: number
  current: number
  deadline: string | null
  status: Wish['status']
  statusText: string
  statusCls: string
  percent: number
  currentText: string
  goalText: string
  hitLog: { date: string; count: number }[]
  completedDate?: string
  fulfilledDate?: string
}

function enrich(w: Wish): WishVM {
  return {
    _id: w._id,
    name: w.name,
    goal: w.goal,
    current: Math.min(w.current, w.goal),
    deadline: w.deadline,
    status: w.status,
    statusText: STATUS_TEXT[w.status] || w.status,
    statusCls: STATUS_CLS[w.status] || '',
    percent: percentOf(w.current, w.goal),
    currentText: fmtInt(Math.min(w.current, w.goal)),
    goalText: fmtInt(w.goal),
    hitLog: Array.isArray(w.hitLog) ? w.hitLog : [],
    completedDate: w.completedDate,
    fulfilledDate: w.fulfilledDate,
  }
}

function buildBars(hitLog: { date: string; count: number }[]): BarItem[] {
  const map: Record<string, number> = {}
  hitLog.forEach((h) => {
    if (h && h.date) map[h.date] = (map[h.date] || 0) + (h.count || 0)
  })
  const today = todayStr()
  const days: string[] = []
  for (let i = 13; i >= 0; i--) days.push(offsetDate(today, -i))
  let max = 1
  days.forEach((d) => {
    max = Math.max(max, map[d] || 0)
  })
  return days.map((d) => {
    const count = map[d] || 0
    return {
      key: d,
      label: String(parseInt(d.slice(8, 10), 10)),
      count,
      ratio: count ? Math.max(8, Math.round((count / max) * 100)) : 0,
      isToday: d === today,
      hasValue: count > 0,
    }
  })
}

Page({
  data: {
    statusBarHeight: 20,
    safeBottom: 0,
    loading: true,
    wishId: '',
    wish: null as WishVM | null,
    bars: [] as BarItem[],
    records: [] as RecordVM[],
    canKnock: false,
    canEdit: false,
    showFulfill: false,
    localToday: 0,
  },

  _alive: false,
  _queue: null as KnockQueue | null,

  onLoad(options: Record<string, string | undefined>) {
    const app = getApp<IAppOption>()
    this._alive = true
    const wishId = (options && options.id) || ''
    // 底部安全区
    let safeBottom = 0
    try {
      const win: any = winInfo()
      if (win.safeArea && win.screenHeight) safeBottom = Math.max(0, win.screenHeight - win.safeArea.bottom)
    } catch (e) {
      safeBottom = 0
    }
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      safeBottom,
      wishId,
    })
    this._queue = new KnockQueue(
      () => {
        const w = this.data.wish
        return w && w.status === 'ongoing' ? w._id : null
      },
      (r) => {
        if (r.completed) {
          this.onCompleted()
        }
      },
      () => {
        if (this._alive) wx.showToast({ title: '功德未能上传，请重试', icon: 'none' })
      }
    )
    this.load()
  },

  onUnload() {
    this._alive = false
    if (this._queue) {
      this._queue.destroy()
      this._queue = null
    }
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  },

  async load() {
    if (!this.data.wishId) return
    try {
      const res = await fetchWishDetail(this.data.wishId)
      if (!this._alive) return
      const vm = enrich(res.wish)
      const bars = buildBars(vm.hitLog)
      const records: RecordVM[] = vm.hitLog
        .slice()
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, 10)
        .map((h) => ({
          date: h.date,
          count: h.count || 0,
          text: fmtMD(h.date) + ' · ' + (h.count || 0) + ' 次',
        }))
      this.setData({
        loading: false,
        wish: vm,
        bars,
        records,
        canKnock: vm.status === 'ongoing',
        canEdit: vm.status !== 'fulfilled',
        showFulfill: vm.status === 'completed',
        localToday: bars.filter((b) => b.isToday).reduce((s, b) => s + b.count, 0),
      })
    } catch (e: any) {
      if (!this._alive) return
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },

  // ===== 敲击 =====
  doKnock() {
    if (!this._alive) return
    const d = this.data
    const w = d.wish
    if (!w || w.status !== 'ongoing') return
    const app = getApp<IAppOption>()
    const st = settingsOf(app.globalData.user)
    playKnock(st.soundOn)
    vibrate(st.vibrateOn)

    const cur = Math.min(w.goal, w.current + 1)
    const justDone = cur >= w.goal
    const next: WishVM = {
      ...w,
      current: cur,
      percent: percentOf(cur, w.goal),
      status: justDone ? 'completed' : 'ongoing',
      statusText: justDone ? '已圆满' : '进行中',
      statusCls: justDone ? 'completed' : 'ongoing',
      currentText: fmtInt(cur),
    }
    // 今日柱 +1
    const bars = d.bars.map((b) =>
      b.isToday ? { ...b, count: b.count + 1, ratio: Math.max(b.ratio, 8), hasValue: true } : b
    )
    this.setData({
      wish: next,
      bars,
      localToday: d.localToday + 1,
      canKnock: !justDone,
      showFulfill: justDone,
    })
    if (this._queue) this._queue.tap(1)
    if (justDone) {
      wx.showToast({ title: '功德圆满，随喜赞叹', icon: 'none' })
    }
  },

  onCompleted() {
    // 云端确认后刷新权威数据
    this.load()
  },

  // ===== 还愿 =====
  doFulfill() {
    const w = this.data.wish
    if (!w || w.status !== 'completed') return
    wx.showModal({
      title: '还愿确认',
      content: '心愿已成，是否正式还愿并生成功德证书？',
      confirmText: '还愿',
      confirmColor: '#c0955f',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '还愿中', mask: true })
        try {
          await fulfillWish(w._id)
          wx.hideLoading()
          wx.showToast({ title: '还愿成功', icon: 'success' })
          setTimeout(() => {
            wx.switchTab({ url: '/pages/certificate/index' })
          }, 600)
        } catch (e: any) {
          wx.hideLoading()
          wx.showToast({ title: (e && e.message) || '还愿失败', icon: 'none' })
        }
      },
    })
  },

  // ===== 修改 =====
  goEdit() {
    const w = this.data.wish
    if (!w || w.status === 'fulfilled') return
    setFormState({ mode: 'edit', wish: w as any })
    wx.switchTab({ url: '/pages/wish-form/index' })
  },
})
