// 心愿详情
import { fetchWishDetail, fetchPaperOrigin, fulfillWish, Wish } from '../../utils/cloud'
import { STATUS_TEXT, STATUS_CLS, percentOf, paperReveal } from '../../utils/constants'
import { setFormState } from '../../utils/formState'
import { applyLesson } from '../../utils/lesson'
import {
  fmtMD,
  fmtFullCN,
  todayStr,
  offsetDate,
  fmtInt,
  winInfo,
  concealTabBar,
  sourceLine,
  dueText,
  diffToday,
  weekdayCN,
} from '../../utils/util'

interface BarItem {
  key: string
  label: string
  count: number
  ratio: number
  isToday: boolean
  hasValue: boolean
  /** 柱顶标数：今天和最高那天 */
  tip: string
}

interface RecordVM {
  date: string
  text: string
  week: string
  count: number
  countText: string
  /** 和最多那天比的宽度 */
  ratio: number
}

interface StatVM {
  label: string
  value: string
  unit: string
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
  sourceText: string
  hitLog: { date: string; count: number }[]
  completedDate?: string
  fulfilledDate?: string
  due: string
  late: boolean
  completedText: string
  fulfilledText: string
}

/** 今年的日子只写月日，往年的写全 */
function dayText(d?: string): string {
  if (!d) return ''
  return d.slice(0, 4) === todayStr().slice(0, 4) ? fmtMD(d) : fmtFullCN(d)
}

function enrich(w: Wish): WishVM {
  const due = w.status === 'ongoing' ? dueText(w.deadline) : { text: '', late: false }
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
    sourceText: sourceLine(w),
    hitLog: Array.isArray(w.hitLog) ? w.hitLog : [],
    completedDate: w.completedDate,
    fulfilledDate: w.fulfilledDate,
    due: due.text,
    late: due.late,
    completedText: dayText(w.completedDate),
    fulfilledText: dayText(w.fulfilledDate),
  }
}

function dayMap(hitLog: { date: string; count: number }[]): Record<string, number> {
  const map: Record<string, number> = {}
  hitLog.forEach((h) => {
    if (h && h.date) map[h.date] = (map[h.date] || 0) + (h.count || 0)
  })
  return map
}

function buildBars(map: Record<string, number>): BarItem[] {
  const today = todayStr()
  const days: string[] = []
  for (let i = 13; i >= 0; i--) days.push(offsetDate(today, -i))
  let max = 1
  days.forEach((d) => {
    max = Math.max(max, map[d] || 0)
  })
  let maxShown = false
  return days.map((d) => {
    const count = map[d] || 0
    const isToday = d === today
    // 柱顶只标今天和最高的那一天，别的不写，免得挤
    let tip = ''
    if (count > 0 && (isToday || (count === max && !maxShown))) tip = fmtInt(count)
    if (count === max && count > 0) maxShown = true
    return {
      key: d,
      label: isToday ? '今' : String(parseInt(d.slice(8, 10), 10)),
      count,
      ratio: count ? Math.max(6, Math.round((count / max) * 100)) : 0,
      isToday,
      hasValue: count > 0,
      tip,
    }
  })
}

/** 坚持几天、有敲的日子平均几下、最多的一天 */
function buildStats(map: Record<string, number>): StatVM[] {
  const days = Object.keys(map).filter((d) => map[d] > 0)
  const total = days.reduce((s, d) => s + map[d], 0)
  const best = days.reduce((m, d) => Math.max(m, map[d]), 0)
  return [
    { label: '坚持', value: String(days.length), unit: '天' },
    { label: '日均', value: days.length ? fmtInt(Math.round(total / days.length)) : '0', unit: '叩' },
    { label: '最多一日', value: fmtInt(best), unit: '叩' },
  ]
}

/** 一句往前看的话：照近七日的节奏多久圆满；有期限就算每天要敲几下 */
function paceLine(w: WishVM, map: Record<string, number>): string {
  if (w.status !== 'ongoing') return ''
  const left = Math.max(0, w.goal - w.current)
  if (!left) return ''
  if (w.deadline) {
    const days = diffToday(w.deadline) + 1
    if (days <= 0) return '期限已过，剩 ' + fmtInt(left) + ' 叩，慢慢来'
    return '按期圆满，每天约需 ' + fmtInt(Math.ceil(left / days)) + ' 叩'
  }
  const today = todayStr()
  let week = 0
  for (let i = 0; i < 7; i++) week += map[offsetDate(today, -i)] || 0
  if (!week) return '近七日还没敲过，回堂敲几下吧'
  const days = Math.ceil(left / (week / 7))
  return days <= 1 ? '照近七日的节奏，明天之前就能圆满' : '照近七日的节奏，约 ' + fmtInt(days) + ' 天后圆满'
}

Page({
  data: {
    statusBarHeight: 20,
    safeBottom: 0,
    loading: true,
    wishId: '',
    wish: null as WishVM | null,
    bars: [] as BarItem[],
    stats: [] as StatVM[],
    pace: '',
    records: [] as RecordVM[],
    canKnock: false,
    canEdit: false,
    canSave: false,
    canFulfill: false,
    revealed: false,
    thumbUrl: '',
    revealOn: false,
    /** 进行中时壁纸显到哪一步 */
    veil: paperReveal(0),
    savingPaper: false,
    localToday: 0,
    /** 图表上点中的那一天 */
    selBar: '',
    selBarText: '',
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
    const toList = () => wx.switchTab({ url: '/pages/wishes/index' })
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1, fail: toList })
    else toList()
  },

  async load() {
    if (!this.data.wishId) return
    try {
      const res = await fetchWishDetail(this.data.wishId)
      if (!this._alive) return
      const vm = enrich(res.wish)
      const map = dayMap(vm.hitLog)
      const bars = buildBars(map)
      const days = Object.keys(map).sort((a, b) => (a < b ? 1 : -1))
      const top = days.reduce((m, d) => Math.max(m, map[d]), 1)
      const records: RecordVM[] = days.slice(0, 10).map((d) => ({
        date: d,
        text: fmtMD(d),
        week: weekdayCN(d),
        count: map[d],
        countText: fmtInt(map[d]),
        ratio: Math.max(4, Math.round((map[d] / top) * 100)),
      }))
      const revealed = vm.status === 'completed' || vm.status === 'fulfilled'
      const thumbUrl = (res.wish && res.wish.thumbUrl) || ''
      this.setData({
        loading: false,
        wish: vm,
        bars,
        stats: buildStats(map),
        pace: paceLine(vm, map),
        records,
        canKnock: vm.status === 'ongoing',
        canEdit: vm.status !== 'fulfilled',
        canSave: revealed && !!thumbUrl,
        canFulfill: vm.status === 'completed',
        revealed,
        thumbUrl,
        revealOn: false,
        veil: paperReveal(vm.goal > 0 ? vm.current / vm.goal : 0),
        localToday: map[todayStr()] || 0,
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

  onPickBar(e: any) {
    const key = String(e.currentTarget.dataset.key || '')
    const bar = this.data.bars.find((b) => b.key === key)
    if (!bar) return
    if (this.data.selBar === key) {
      this.setData({ selBar: '', selBarText: '' })
      return
    }
    const when = bar.isToday ? '今日' : fmtMD(key) + ' ' + weekdayCN(key)
    this.setData({ selBar: key, selBarText: when + (bar.count ? ' · ' + fmtInt(bar.count) + ' 叩' : ' · 未敲') })
  },

  goAltar() {
    const w = this.data.wish
    if (!w || w.status !== 'ongoing') return
    applyLesson({ mode: 'wish', wishId: w._id, name: w.name })
    getApp<IAppOption>().globalData.homeEnterAnim = true
    concealTabBar(this)
    wx.switchTab({ url: '/pages/home/index' })
  },

  goCert() {
    const w = this.data.wish
    if (!w || w.status === 'ongoing') return
    getApp<IAppOption>().globalData.certFocusId = w._id
    wx.switchTab({ url: '/pages/certificate/index' })
  },

  /** 专注已满的心愿，现实里也成了：了结它，证书上落「了结」的日子 */
  askFulfill() {
    const w = this.data.wish
    if (!w || w.status !== 'completed') return
    wx.showModal({
      title: '愿已成真？',
      content: '了结后这个心愿就收起来了，证书上会记下今天。',
      confirmText: '了结',
      confirmColor: '#c4925a',
      cancelText: '再等等',
      success: (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '正在了结', mask: true })
        fulfillWish(w._id)
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已了结 · 愿你所愿皆成', icon: 'none' })
            this.load()
          })
          .catch((e: any) => {
            wx.hideLoading()
            wx.showToast({ title: (e && e.message) || '了结失败', icon: 'none' })
          })
      },
    })
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
            } else if (!(err && err.errMsg && err.errMsg.indexOf('cancel') >= 0)) {
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

  onShareAppMessage() {
    const w = this.data.wish
    const title = w
      ? w.status === 'ongoing'
        ? '我在为「' + w.name + '」轻叩木鱼，已积 ' + w.currentText + ' 叩'
        : '「' + w.name + '」心愿圆满，共积 ' + w.currentText + ' 叩'
      : '小叩木鱼 · 轻叩一声，万缘放下'
    return { title, path: '/pages/gate/index' }
  },
})
