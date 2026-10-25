import { fetchWishes, Wish } from '../../utils/cloud'
import { applyLesson, RANDOM_LESSON } from '../../utils/lesson'

interface WishRow {
  _id: string
  name: string
  mark: string
  cur: boolean
}

function enterAltar(mode: 'wish' | 'random', wishId: string | null, name?: string) {
  applyLesson(mode === 'wish' && wishId ? { mode: 'wish', wishId, name: name || '心愿' } : RANDOM_LESSON)
  getApp<IAppOption>().globalData.fromGate = true
  wx.switchTab({ url: '/pages/home/index' })
}

function toRows(wishes: Wish[], curId: string | null): WishRow[] {
  return wishes
    .filter((w) => w.status === 'ongoing')
    .map((w) => ({
      _id: w._id,
      name: w.name || '无名心愿',
      mark: w.current + ' · ' + w.goal,
      cur: w._id === curId,
    }))
}

function currentWishId(): string | null {
  const app = getApp<IAppOption>()
  return app.globalData.knockMode === 'wish' ? app.globalData.knockWishId || null : null
}

Page({
  data: {
    statusBarHeight: 20,
    /** 从香案顶部点开：作为切换面板，可返回，心愿列表默认展开 */
    fromHome: false,
    randomCur: false,
    wishOpen: false,
    loaded: false,
    wishes: [] as WishRow[],
  },

  _alive: false,
  _loaded: false,
  _wantWish: false,

  onLoad(options: Record<string, string | undefined>) {
    this._alive = true
    const app = getApp<IAppOption>()
    const fromHome = !!(options && options.from === 'home')
    this._wantWish = fromHome
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      fromHome,
      randomCur: fromHome && app.globalData.knockMode !== 'wish',
      wishOpen: fromHome,
    })
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
    let wishes: WishRow[] = []
    try {
      const res = await fetchWishes()
      wishes = toRows(res.wishes || [], this.data.fromHome ? currentWishId() : null)
    } catch {
      wishes = []
    }
    if (!this._alive) return
    this._loaded = true
    this.setData({ loaded: true, wishes })
    if (this._wantWish) this.setData({ wishOpen: true })
  },

  onWishPath() {
    this._wantWish = true
    this.setData({ wishOpen: true })
  },

  onPickWish(e: any) {
    const id = (e.currentTarget.dataset.id as string) || ''
    if (!id) return
    const row = this.data.wishes.find((w) => w._id === id)
    enterAltar('wish', id, row && row.name)
  },

  onRandom() {
    enterAltar('random', null)
  },

  onGoForm() {
    wx.navigateTo({ url: '/pages/wish-form/index' })
  },

  onBack() {
    wx.navigateBack({ delta: 1 })
  },
})
