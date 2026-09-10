import { fetchWishes, Wish } from '../../utils/cloud'

interface WishRow {
  _id: string
  name: string
  mark: string
}

function enterAltar(mode: 'wish' | 'random', wishId: string | null) {
  const app = getApp<IAppOption>()
  app.globalData.lessonChosen = true
  app.globalData.knockMode = mode
  app.globalData.knockWishId = wishId
  app.globalData.fromGate = true
  wx.switchTab({ url: '/pages/home/index' })
}

function toRows(wishes: Wish[]): WishRow[] {
  return wishes
    .filter((w) => w.status === 'ongoing')
    .map((w) => ({
      _id: w._id,
      name: w.name || '无名心愿',
      mark: w.current + ' · ' + w.goal,
    }))
}

Page({
  data: {
    wishOpen: false,
    loaded: false,
    wishes: [] as WishRow[],
  },

  _alive: false,
  _loaded: false,
  _wantWish: false,

  onLoad() {
    this._alive = true
    this.loadWishes()
  },

  onShow() {
    if (this._loaded) this.loadWishes()
  },

  onUnload() {
    this._alive = false
  },

  noop() {},

  async loadWishes() {
    try {
      const res = await fetchWishes()
      if (!this._alive) return
      this._loaded = true
      this.setData({ loaded: true, wishes: toRows(res.wishes || []) })
      if (this._wantWish) this.setData({ wishOpen: true })
    } catch {
      if (!this._alive) return
      this._loaded = true
      this.setData({ loaded: true, wishes: [] })
      if (this._wantWish) this.setData({ wishOpen: true })
    }
  },

  onWishPath() {
    this._wantWish = true
    this.setData({ wishOpen: true })
  },

  onPickWish(e: any) {
    const id = (e.currentTarget.dataset.id as string) || ''
    if (!id) return
    enterAltar('wish', id)
  },

  onRandom() {
    enterAltar('random', null)
  },

  onGoForm() {
    wx.switchTab({ url: '/pages/wish-form/index' })
  },
})
