// app.ts
import { ensureKnock } from './utils/knock'
import { ensureSmokeTexture } from './utils/smoke'
import { loginUser } from './utils/cloud'
import { winInfo } from './utils/util'

App<IAppOption>({
  globalData: {
    statusBarHeight: 20,
    user: null,
  },

  onLaunch() {
    // 状态栏高度（自定义导航栏适配）
    try {
      const win: any = winInfo()
      this.globalData.statusBarHeight = (win.statusBarHeight as number) || 20
    } catch (e) {
      this.globalData.statusBarHeight = 20
    }

    // 初始化云开发（使用当前环境）
    if (wx.cloud) {
      try {
        const cloudAny: any = wx.cloud
        wx.cloud.init({ env: cloudAny.DYNAMIC_CURRENT_ENV || undefined, traceUser: true })
      } catch (e) {
        console.warn('cloud init failed', e)
      }
    } else {
      console.warn('当前基础库版本过低，无法使用云能力，请使用 2.2.3 以上基础库')
    }

    // 预生成敲击音效文件
    ensureKnock()

    try {
      const anyWx: any = wx
      if (typeof anyWx.loadSubpackage === 'function') {
        anyWx.loadSubpackage({ name: 'smoke' })
      }
    } catch {
      // 分包稍后由香案页再拉
    }

    // 注册 XR-Frame 柔边烟点纹理（木鱼页青烟氛围用，不支持时静默跳过）
    ensureSmokeTexture()

    // 静默登录：获取 openid 并初始化 users 记录（无感）
    if (wx.cloud) {
      loginUser()
        .then((res) => {
          this.globalData.user = res.user
        })
        .catch((e) => {
          console.warn('login failed', e)
        })
    }
  },
})
