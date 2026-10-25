import { concealTabBar, safeBottomPx } from '../../utils/util'

const LINKS = [
  { index: 1, url: '/pages/wishes/index', name: '心愿' },
  { index: 2, url: '/pages/certificate/index', name: '证书' },
  { index: 3, url: '/pages/profile/index', name: '静心' },
]

function hostPage(): any {
  const pages = getCurrentPages()
  return pages.length ? pages[pages.length - 1] : null
}

Component({
  options: {
    virtualHost: true,
  },

  properties: {
    mode: {
      type: String,
      value: 'hall',
    },
    current: {
      type: Number,
      value: 0,
    },
  },

  data: {
    links: LINKS,
    open: false,
    pad: 36,
  },

  lifetimes: {
    attached() {
      const wing = this.properties.mode === 'wing'
      this.setData({
        pad: safeBottomPx() + 36,
        open: wing,
      })
    },
  },

  observers: {
    mode(v: string) {
      if (v === 'wing') this.setData({ open: true })
    },
  },

  methods: {
    onNoop() {},

    onMask() {
      if (this.properties.mode !== 'hall') return
      this.setData({ open: false })
    },

    onHair() {
      if (this.properties.mode === 'wing') {
        const app = getApp<IAppOption>()
        app.globalData.homeEnterAnim = true
        concealTabBar(hostPage())
        wx.switchTab({ url: '/pages/home/index' })
        return
      }
      this.setData({ open: !this.data.open })
    },

    onPick(e: any) {
      const index = Number(e.currentTarget.dataset.index)
      const url = (e.currentTarget.dataset.url as string) || ''
      if (!url || index === this.properties.current) return
      const app = getApp<IAppOption>()
      if (this.properties.mode === 'hall') {
        app.globalData.homeWillReenter = true
        this.setData({ open: false })
      }
      concealTabBar(hostPage())
      wx.switchTab({ url })
    },
  },
})
