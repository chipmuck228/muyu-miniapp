import { previewActivate, activateChannel } from '../../utils/cloud'
import { resolveCloudFile } from '../../utils/cloudFile'
import { concealTabBar } from '../../utils/util'

function codeFromOptions(opt: any): string {
  if (!opt) return ''
  const q = opt.query || {}
  let s = String(q.scene || q.ac || '')
  if (!s && typeof opt.scene === 'string' && opt.scene.indexOf('ac_') === 0) {
    s = opt.scene
  }
  try {
    s = decodeURIComponent(s)
  } catch (e) {
    // keep
  }
  s = String(s || '').trim()
  if (s.indexOf('ac_') === 0) s = s.slice(3)
  s = s.toUpperCase()
  if (/^[A-Z0-9]{6}$/.test(s) && !/^\d+$/.test(s)) return s
  return ''
}

Page({
  data: {
    statusBarHeight: 20,
    phase: 'none' as 'authorized' | 'error',
    name: '',
    code: '',
    qrSrc: '',
    err: '',
    busy: false,
  },

  _activating: false,

  onLoad(opt: any) {
    const app = getApp<IAppOption>()
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
    const sceneCode = codeFromOptions(opt)
    if (!sceneCode) {
      wx.redirectTo({ url: '/pages/partner/index' })
      return
    }
    this.refresh(sceneCode)
  },

  goHall() {
    const app = getApp<IAppOption>()
    app.globalData.homeEnterAnim = true
    concealTabBar(this)
    wx.switchTab({ url: '/pages/home/index' })
  },

  async refresh(sceneCode: string) {
    try {
      const p = await previewActivate(sceneCode)
      let qrSrc = ''
      if (p.fileID) qrSrc = await resolveCloudFile(p.fileID).catch(() => '')
      this.setData({
        phase: 'authorized',
        name: p.name || '渠道',
        code: sceneCode,
        qrSrc,
        err: '',
      })
    } catch (e: any) {
      wx.redirectTo({ url: '/pages/partner/index' })
    }
  },

  async doActivate() {
    if (this._activating) return
    const code = this.data.code.trim().toUpperCase()
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      wx.showToast({ title: '激活码无效', icon: 'none' })
      return
    }
    this._activating = true
    this.setData({ busy: true })
    try {
      await activateChannel(code)
      wx.redirectTo({ url: '/pages/partner/index' })
    } catch (e: any) {
      this._activating = false
      this.setData({
        busy: false,
        phase: 'error',
        err: (e && e.message) || '激活失败',
      })
    }
  },
})
