// 心愿列表：进行中在上、已圆满在下；轻触回堂敲击，长按更多操作
import { fetchWishes, removeWish, cachedSettings, Wish } from '../../utils/cloud'
import { percentOf } from '../../utils/constants'
import { concealTabBar, fmtInt, fmtMD, todayStr, dueText } from '../../utils/util'
import { applyLesson, forgetWish } from '../../utils/lesson'
import { setFormState } from '../../utils/formState'
import { vibrate } from '../../utils/knock'
import { WISH_SUGGESTIONS } from '../../utils/wishIdeas'

interface WishVM {
  _id: string
  name: string
  goal: number
  percent: number
  nums: string
  /** 今天为它敲了几下，没敲为空 */
  today: string
  due: string
  late: boolean
  done: boolean
  /** 已圆满 / 已了结的日期 */
  doneText: string
  fulfilled: boolean
  /** 进度到九成以上：进度条亮一些 */
  near: boolean
  /** 当前的今日功课 */
  cur: boolean
}

function build(w: Wish, today: string, curId: string | null): WishVM {
  const percent = percentOf(w.current, w.goal)
  const done = w.status !== 'ongoing'
  const log = (w.hitLog || []).find((h) => h && h.date === today)
  const due = done ? { text: '', late: false } : dueText(w.deadline)
  const doneDate = w.fulfilledDate || w.completedDate || ''
  return {
    _id: w._id,
    name: w.name,
    goal: w.goal,
    percent,
    nums: fmtInt(Math.min(w.current, w.goal)) + ' / ' + fmtInt(w.goal),
    today: log && log.count > 0 ? '今日 ' + fmtInt(log.count) : '',
    due: due.text,
    late: due.late,
    done,
    doneText: doneDate ? fmtMD(doneDate) + (w.status === 'fulfilled' ? ' 了结' : ' 圆满') : '',
    fulfilled: w.status === 'fulfilled',
    near: !done && percent >= 90,
    cur: !done && w._id === curId,
  }
}

function currentWishId(): string | null {
  const app = getApp<IAppOption>()
  return app.globalData.knockMode === 'wish' ? app.globalData.knockWishId || null : null
}

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    refreshing: false,
    ongoing: [] as WishVM[],
    done: [] as WishVM[],
    total: 0,
    ideas: WISH_SUGGESTIONS.slice(0, 6),
    failed: false,
  },

  _alive: false,
  /** 云端原样的心愿，改愿时交给表单 */
  _raw: {} as Record<string, Wish>,

  onLoad() {
    const app = getApp<IAppOption>()
    this._alive = true
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    concealTabBar(this)
    this.load(false)
  },

  onUnload() {
    this._alive = false
  },

  async load(byRefresh: boolean) {
    if (byRefresh) {
      this.setData({ refreshing: true })
    } else if (this.data.total === 0) {
      this.setData({ loading: true })
    }
    try {
      const res = await fetchWishes()
      if (!this._alive) return
      const today = todayStr()
      const curId = currentWishId()
      // 各组内保持云端的新→旧顺序
      const list = res.wishes || []
      const raw: Record<string, Wish> = {}
      list.forEach((w) => {
        raw[w._id] = w
      })
      this._raw = raw
      const all = list.map((w) => build(w, today, curId))
      this.setData({
        loading: false,
        refreshing: false,
        failed: false,
        ongoing: all.filter((w) => !w.done),
        done: all.filter((w) => w.done),
        total: all.length,
      })
    } catch (e: any) {
      if (!this._alive) return
      this.setData({ loading: false, refreshing: false, failed: this.data.total === 0 })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },

  onRefresh() {
    this.load(true)
  },

  goNew() {
    wx.navigateTo({ url: '/pages/wish-form/index' })
  },

  /** 空列表上的建议：带着名字去立愿 */
  onIdea(e: any) {
    const name = String(e.currentTarget.dataset.name || '')
    wx.navigateTo({ url: '/pages/wish-form/index?name=' + encodeURIComponent(name) })
  },

  find(id: string): WishVM | null {
    return this.data.ongoing.find((x) => x._id === id) || this.data.done.find((x) => x._id === id) || null
  },

  /** 轻触心愿：进行中的直接回堂敲击；已圆满的没法再敲，打开详情 */
  onPickWish(e: any) {
    const id = (e.currentTarget.dataset.id as string) || ''
    const w = this.find(id)
    if (!w) return
    if (w.done) {
      this.openDetail(e)
      return
    }
    this.knockFor(w)
  },

  knockFor(w: WishVM) {
    applyLesson({ mode: 'wish', wishId: w._id, name: w.name })
    getApp<IAppOption>().globalData.homeEnterAnim = true
    concealTabBar(this)
    wx.switchTab({ url: '/pages/home/index' })
  },

  /** 已圆满那一行的「证书 ›」：直接翻到这张证书 */
  openCert(e: any) {
    const id = (e.currentTarget.dataset.id as string) || ''
    if (!id) return
    getApp<IAppOption>().globalData.certFocusId = id
    concealTabBar(this)
    wx.switchTab({ url: '/pages/certificate/index' })
  },

  openDetail(e: any) {
    const id = e.currentTarget.dataset.id
    if (id) {
      wx.navigateTo({ url: '/pages/wish-detail/index?id=' + id })
    }
  },

  /** 长按：回堂敲击 / 详情 / 改愿 / 删除 */
  onLongPress(e: any) {
    const id = (e.currentTarget.dataset.id as string) || ''
    const w = this.find(id)
    if (!w) return
    vibrate(cachedSettings().vibrateOn, 'light')
    const items = w.done ? ['详情', '删除'] : ['回堂敲击', '详情', '改愿', '删除']
    wx.showActionSheet({
      itemList: items,
      itemColor: '#333333',
      success: (r) => {
        const act = items[r.tapIndex]
        if (act === '回堂敲击') this.knockFor(w)
        else if (act === '详情') wx.navigateTo({ url: '/pages/wish-detail/index?id=' + w._id })
        else if (act === '改愿') this.editWish(w)
        else if (act === '删除') this.askRemove(w)
      },
    })
  },

  editWish(w: WishVM) {
    const full = this._raw[w._id]
    if (!full) return
    setFormState({ mode: 'edit', wish: full })
    wx.navigateTo({ url: '/pages/wish-form/index' })
  },

  askRemove(w: WishVM) {
    wx.showModal({
      title: '删除这个心愿？',
      content:
        '「' + w.name + '」' +
        (w.done ? '和它的证书、记录会一起删掉，不能恢复。' : '和它的记录会删掉；已敲的专注仍算在总数里。'),
      confirmText: '删除',
      confirmColor: '#c0614a',
      cancelText: '留着',
      success: (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '正在删除', mask: true })
        removeWish(w._id)
          .then(() => {
            wx.hideLoading()
            forgetWish(w._id)
            wx.showToast({ title: '已删除', icon: 'none' })
            this.load(false)
          })
          .catch((err: any) => {
            wx.hideLoading()
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          })
      },
    })
  },
})
