// 自定义底部 TabBar：4 项，100rpx 高 + 底部安全区
import { winInfo } from '../utils/util'

interface TabItem {
  pagePath: string
  text: string
  icon: string
}

Component({
  data: {
    selected: 0,
    hidden: true,
    homePulse: false,
    safeBottom: 0,
    list: [
      { pagePath: '/pages/home/index', text: '木鱼', icon: '🪷' },
      { pagePath: '/pages/wishes/index', text: '心愿', icon: '❤️' },
      { pagePath: '/pages/certificate/index', text: '证书', icon: '📜' },
      { pagePath: '/pages/profile/index', text: '静心', icon: '👤' },
    ] as TabItem[],
  },

  lifetimes: {
    attached() {
      // 底部安全区适配
      try {
        const win: any = winInfo()
        const safe = win.safeArea
        if (safe && win.screenHeight) {
          this.setData({ safeBottom: Math.max(0, win.screenHeight - safe.bottom) })
        }
      } catch {
        this.setData({ safeBottom: 0 })
      }
    },
  },

  methods: {
    onTap(e: any) {
      const index = Number(e.currentTarget.dataset.index)
      const item = this.data.list[index]
      if (!item || index === this.data.selected) return
      const app = getApp<IAppOption>()
      // 离开木鱼：让首页先盖上入堂遮罩，切回来时第一帧就是过渡而不是旧画面
      if (this.data.selected === 0 && index !== 0) {
        app.globalData.homeWillReenter = true
      }
      if (index === 0) {
        app.globalData.homeEnterAnim = true
      }
      this.setData({ selected: index, homePulse: index === 0 })
      wx.switchTab({ url: item.pagePath })
      if (index === 0) {
        setTimeout(() => {
          this.setData({ homePulse: false })
        }, 420)
      }
    },
  },
})
