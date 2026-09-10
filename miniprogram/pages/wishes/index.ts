// 心愿列表
import { fetchWishes, Wish } from '../../utils/cloud'
import { percentOf } from '../../utils/constants'
import { concealTabBar } from '../../utils/util'

interface WishVM {
  _id: string
  name: string
  percent: number
}

function build(w: Wish): WishVM {
  return {
    _id: w._id,
    name: w.name,
    percent: percentOf(w.current, w.goal),
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

  openDetail(e: any) {
    const id = e.currentTarget.dataset.id
    if (id) {
      wx.navigateTo({ url: '/pages/wish-detail/index?id=' + id })
    }
  },
})
