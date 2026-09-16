// app.ts
import { ensureKnock } from './utils/knock'
import { ensureSmokeTexture } from './utils/smoke'
import { loginUser, bindChannelByScene, normalizeChannelScene } from './utils/cloud'
import { winInfo } from './utils/util'

// 云开发环境 ID（如需切换环境，改这里即可）
const CLOUD_ENV = 'cloud1-d5gcfyv8v980774aa'

function pickChannelScene(opt: any): string {
  if (!opt) return ''
  const q = opt.query || {}
  let s = String(q.scene || q.ch || '')
  if (!s && typeof opt.scene === 'string') s = opt.scene
  return normalizeChannelScene(s)
}

App<IAppOption>({
  globalData: {
    statusBarHeight: 20,
    user: null,
    pendingChannelScene: null as string | null,
  },

  onLaunch(opt: any) {
    const scene = pickChannelScene(opt)
    if (scene.indexOf('ch_') === 0) this.globalData.pendingChannelScene = scene
    // 状态栏高度（自定义导航栏适配）
    try {
      const win: any = winInfo()
      this.globalData.statusBarHeight = (win.statusBarHeight as number) || 20
    } catch (e) {
      this.globalData.statusBarHeight = 20
    }

    // 初始化云开发（显式指定环境，避免多环境时跑错）
    if (wx.cloud) {
      try {
        wx.cloud.init({ env: CLOUD_ENV, traceUser: true })
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
    if (this.globalData.pendingChannelScene) {
      bindChannelByScene(this.globalData.pendingChannelScene).catch(() => {})
    }
  },

  onShow(opt: any) {
    const scene = pickChannelScene(opt)
    if (scene.indexOf('ch_') === 0) {
      this.globalData.pendingChannelScene = scene
      bindChannelByScene(scene).catch(() => {})
    }
  },
})
