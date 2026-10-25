// 心愿详情
import { fetchWishDetail, fetchPaperOrigin, Wish } from '../../utils/cloud'
import { STATUS_TEXT, STATUS_CLS, percentOf } from '../../utils/constants'
import { setFormState } from '../../utils/formState'
import { applyLesson } from '../../utils/lesson'
import { fmtMD, todayStr, offsetDate, fmtInt, winInfo, concealTabBar } from '../../utils/util'

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
    canSave: false,
    revealed: false,
    thumbUrl: '',
    revealOn: false,
    savingPaper: false,
    localToday: 0,
  },

  _alive: false,
  _revealTimer: 0 as any,
  _needReload: false,

  onLoad(options: Record<string, string | undefined>) {
    const app = getApp<IAppOption>()
    this._alive = true
    const wishId = (options && options.id) || ''
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
    this.load()
  },

  onShow() {
    // 从修改页返回：重新拉取
    if (this._needReload) {
      this._needReload = false
      this.load()
    }
  },

  onUnload() {
    this._alive = false
    if (this._revealTimer) {
      clearTimeout(this._revealTimer)
      this._revealTimer = 0
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
          text: fmtMD(h.date),
        }))
      const revealed = vm.status === 'completed' || vm.status === 'fulfilled'
      const thumbUrl = (res.wish && res.wish.thumbUrl) || ''
      this.setData({
        loading: false,
        wish: vm,
        bars,
        records,
        canKnock: vm.status === 'ongoing',
        canEdit: vm.status !== 'fulfilled',
        canSave: revealed,
        revealed,
        thumbUrl,
        revealOn: false,
        localToday: bars.filter((b) => b.isToday).reduce((s, b) => s + b.count, 0),
      })
      if (revealed && thumbUrl) {
        if (this._revealTimer) clearTimeout(this._revealTimer)
        this._revealTimer = setTimeout(() => {
          if (this._alive) this.setData({ revealOn: true })
        }, 40)
      }
    } catch (e: any) {
      if (!this._alive) return
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },

  goAltar() {
    const w = this.data.wish
    if (!w || w.status !== 'ongoing') return
    applyLesson({ mode: 'wish', wishId: w._id, name: w.name })
    getApp<IAppOption>().globalData.homeEnterAnim = true
    concealTabBar(this)
    wx.switchTab({ url: '/pages/home/index' })
  },


  savePaper() {
    const w = this.data.wish
    if (!w || this.data.savingPaper) return
    if (w.status !== 'completed' && w.status !== 'fulfilled') return
    this.setData({ savingPaper: true })
    wx.showLoading({ title: '取图中', mask: true })
    fetchPaperOrigin(w._id)
      .then((r) => {
        if (r.localPath) return r.localPath
        if (r.originFileId) {
          return wx.cloud.downloadFile({ fileID: r.originFileId }).then((dl) => {
            if (dl && dl.tempFilePath) return dl.tempFilePath
            throw new Error('下载失败')
          })
        }
        if (!r.originUrl) throw new Error('壁纸尚未就绪')
        return new Promise<string>((resolve, reject) => {
          wx.downloadFile({
            url: r.originUrl,
            success: (dl) => {
              if (dl.statusCode === 200 && dl.tempFilePath) resolve(dl.tempFilePath)
              else reject(new Error('下载失败'))
            },
            fail: () => reject(new Error('下载失败')),
          })
        })
      })
      .then((filePath) => {
        wx.hideLoading()
        wx.saveImageToPhotosAlbum({
          filePath,
          success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
          fail: (err: any) => {
            if (err && err.errMsg && err.errMsg.indexOf('auth deny') >= 0) {
              wx.showModal({
                title: '需要相册权限',
                content: '请在设置中开启「保存到相册」权限',
                confirmText: '去设置',
                success: (res) => {
                  if (res.confirm) wx.openSetting()
                },
              })
            } else {
              wx.showToast({ title: '保存失败', icon: 'none' })
            }
          },
        })
      })
      .catch((e: any) => {
        wx.hideLoading()
        wx.showToast({ title: (e && e.message) || '壁纸尚未就绪', icon: 'none' })
      })
      .then(() => {
        if (this._alive) this.setData({ savingPaper: false })
      })
  },

  goEdit() {
    const w = this.data.wish
    if (!w || w.status === 'fulfilled') return
    setFormState({ mode: 'edit', wish: w as any })
    this._needReload = true
    wx.navigateTo({ url: '/pages/wish-form/index' })
  },
})
