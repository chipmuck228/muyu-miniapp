// 心愿列表
import { fetchWishes, Wish } from '../../utils/cloud'
import { percentOf } from '../../utils/constants'
import { concealTabBar, fmtInt } from '../../utils/util'
import { applyLesson } from '../../utils/lesson'

interface WishVM {
  _id: string
  name: string
  percent: number
  mark: string
  done: boolean
}

function build(w: Wish): WishVM {
  const percent = percentOf(w.current, w.goal)
  const done = w.status !== 'ongoing'
  return {
    _id: w._id,
    name: w.name,
    percent,
    mark:
      fmtInt(w.current) + ' / ' + fmtInt(w.goal) +
      (w.status === 'fulfilled' ? ' · 已了结' : w.status === 'completed' ? ' · 已成' : ''),
    done,
  }
}

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    refreshing: false,
    wishes: [] as WishVM[],
  },

  _alive: false,

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
    } else if (this.data.wishes.length === 0) {
      this.setData({ loading: true })
    }
    try {
      const res = await fetchWishes()
      if (!this._alive) return
      this.setData({
        loading: false,
        refreshing: false,
        wishes: res.wishes.map(build),
      })
    } catch (e: any) {
      if (!this._alive) return
      this.setData({ loading: false, refreshing: false })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },

  onRefresh() {
    this.load(true)
  },

  goNew() {
    wx.navigateTo({ url: '/pages/wish-form/index' })
  },

  /** 轻触心愿：进行中的直接回堂敲击；已圆满的没法再敲，打开详情 */
  onPickWish(e: any) {
    const id = (e.currentTarget.dataset.id as string) || ''
    const w = this.data.wishes.find((x) => x._id === id)
    if (!w) return
    if (w.done) {
      this.openDetail(e)
      return
    }
    applyLesson({ mode: 'wish', wishId: w._id, name: w.name })
    getApp<IAppOption>().globalData.homeEnterAnim = true
    concealTabBar(this)
    wx.switchTab({ url: '/pages/home/index' })
  },

  openDetail(e: any) {
    const id = e.currentTarget.dataset.id
    if (id) {
      wx.navigateTo({ url: '/pages/wish-detail/index?id=' + id })
    }
  },
})
