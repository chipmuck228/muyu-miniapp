// 心愿证书（Canvas 绘制，保存相册 / 转发）
import { fetchWishes } from '../../utils/cloud'
import { fmtInt, fmtFullCN, winInfo, concealTabBar } from '../../utils/util'

const CW = 400
const CH = 560

interface CertInfo {
  _id: string
  name: string
  totalText: string
  dateText: string
}

function toCert(w: { _id: string; name: string; current: number; fulfilledDate?: string; completedDate?: string }): CertInfo {
  return {
    _id: w._id,
    name: w.name,
    totalText: fmtInt(w.current),
    dateText: fmtFullCN(w.fulfilledDate || w.completedDate || ''),
  }
}

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    hasCert: false,
    certs: [] as CertInfo[],
    cert: null as CertInfo | null,
    certPath: '',
    drawing: false,
  },

  onLoad() {
    const app = getApp<IAppOption>()
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    concealTabBar(this)
    this.loadCert()
  },

  async loadCert() {
    try {
      const res = await fetchWishes()
      const list = res.wishes
      const fulfilled = list.filter((w) => w.status === 'fulfilled')
      const completed = list.filter((w) => w.status === 'completed')
      const certs = fulfilled.concat(completed).map(toCert)
      const keepId = this.data.cert && this.data.cert._id
      const pick = certs.find((c) => c._id === keepId) || certs[0] || null
      if (!pick) {
        this.setData({ loading: false, hasCert: false, certs: [], cert: null, certPath: '' })
        return
      }
      this.setData({ loading: false, hasCert: true, certs, cert: pick, certPath: '' })
      wx.nextTick(() => {
        setTimeout(() => this.drawCert(pick), 60)
      })
    } catch (e: any) {
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },

  pickCert(e: any) {
    const id = (e.currentTarget.dataset.id as string) || ''
    const pick = this.data.certs.find((c) => c._id === id)
    if (!pick || (this.data.cert && pick._id === this.data.cert._id)) return
    this.setData({ cert: pick, certPath: '' })
    wx.nextTick(() => {
      setTimeout(() => this.drawCert(pick), 60)
    })
  },

  drawCert(info: CertInfo) {
    const query: any = wx.createSelectorQuery()
    query
      .select('#certCanvas')
      .fields({ node: true, size: true })
      .exec((res: any[]) => {
        if (!res || !res[0] || !res[0].node) {
          this.setData({ drawing: false })
          return
        }
        const canvas = res[0].node
        const win: any = winInfo()
        const dpr = Math.min(win.pixelRatio || 2, 3)
        canvas.width = CW * dpr
        canvas.height = CH * dpr
        const ctx = canvas.getContext('2d')
        ctx.scale(dpr, dpr)

        this.paintCert(ctx, info)
        const anyWx: any = wx
        anyWx.canvasToTempFilePath({
          canvas,
          fileType: 'png',
          success: (r: any) => {
            this.setData({ certPath: r.tempFilePath, drawing: false })
          },
          fail: () => {
            this.setData({ drawing: false })
            wx.showToast({ title: '证书生成失败', icon: 'none' })
          },
        })
      })
  },

  paintCert(ctx: any, info: CertInfo) {
    const w = CW
    const h = CH

    const ivory = ctx.createLinearGradient(0, 0, 0, h)
    ivory.addColorStop(0, '#f4ead8')
    ivory.addColorStop(0.45, '#efe2cc')
    ivory.addColorStop(1, '#e6d4b8')
    ctx.fillStyle = ivory
    ctx.fillRect(0, 0, w, h)

    this.paintGrain(ctx, w, h)
    this.paintVignette(ctx, w, h)

    const gold = 'rgba(168, 132, 78, 0.85)'
    const ink = '#5c4630'
    const mute = '#8a7358'
    const inkDeep = '#3f2e1c'

    ctx.strokeStyle = gold
    ctx.lineWidth = 1.2
    ctx.strokeRect(18, 18, w - 36, h - 36)
    ctx.lineWidth = 0.6
    ctx.strokeRect(24, 24, w - 48, h - 48)

    const b = 32
    const len = 18
    ctx.lineWidth = 1.4
    ctx.strokeStyle = 'rgba(154, 118, 64, 0.9)'
    this.cornerMark(ctx, b, b, 1, 1, len)
    this.cornerMark(ctx, w - b, b, -1, 1, len)
    this.cornerMark(ctx, b, h - b, 1, -1, len)
    this.cornerMark(ctx, w - b, h - b, -1, -1, len)

    ctx.fillStyle = inkDeep
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '22px "Songti SC", "STSong", "PingFang SC", serif'
    this.fillTracked(ctx, '心愿证书', w / 2, 78, 14)

    ctx.strokeStyle = 'rgba(168, 132, 78, 0.55)'
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(w / 2 - 48, 102)
    ctx.lineTo(w / 2 + 48, 102)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(w / 2, 102, 1.6, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(168, 132, 78, 0.7)'
    ctx.fill()

    ctx.fillStyle = mute
    ctx.font = '13px "PingFang SC", sans-serif'
    this.fillTracked(ctx, '兹证明', w / 2, 148, 10)

    let name = (info.name || '').trim()
    if (name.length > 16) name = name.slice(0, 15) + '…'
    ctx.fillStyle = inkDeep
    ctx.font = '28px "Songti SC", "STSong", "PingFang SC", serif'
    ctx.fillText(name, w / 2, 208)

    ctx.strokeStyle = 'rgba(168, 132, 78, 0.28)'
    ctx.lineWidth = 0.6
    ctx.beginPath()
    ctx.moveTo(w / 2 - 90, 236)
    ctx.lineTo(w / 2 + 90, 236)
    ctx.stroke()

    ctx.fillStyle = ink
    ctx.font = '14px "PingFang SC", sans-serif'
    ctx.fillText('于专注之中', w / 2, 286)
    ctx.fillText('诚心所至，如愿以偿', w / 2, 312)

    ctx.fillStyle = mute
    ctx.font = '13px "PingFang SC", sans-serif'
    this.fillTracked(ctx, '共积专注  ' + info.totalText, w / 2, 368, 3)

    ctx.textAlign = 'left'
    ctx.fillStyle = mute
    ctx.font = '12px "PingFang SC", sans-serif'
    ctx.fillText(info.dateText, 48, h - 58)

    this.paintSeal(ctx, w - 78, h - 86, 34)
  },

  paintGrain(ctx: any, w: number, h: number) {
    ctx.save()
    ctx.globalAlpha = 0.035
    ctx.fillStyle = '#6b542e'
    for (let i = 0; i < 420; i++) {
      const x = (i * 73) % w
      const y = (i * 137) % h
      ctx.fillRect(x, y, 1.2, 1.2)
    }
    ctx.globalAlpha = 0.02
    ctx.fillStyle = '#fff8ec'
    for (let i = 0; i < 180; i++) {
      const x = (i * 97) % w
      const y = (i * 53) % h
      ctx.fillRect(x, y, 1.4, 1)
    }
    ctx.restore()
  },

  paintVignette(ctx: any, w: number, h: number) {
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.22, w / 2, h / 2, h * 0.72)
    g.addColorStop(0, 'rgba(80, 52, 24, 0)')
    g.addColorStop(1, 'rgba(80, 52, 24, 0.08)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  },

  fillTracked(ctx: any, text: string, cx: number, y: number, gap: number) {
    const chars = text.split('')
    const widths = chars.map((c) => ctx.measureText(c).width)
    let total = gap * Math.max(0, chars.length - 1)
    widths.forEach((n) => {
      total += n
    })
    let x = cx - total / 2
    const prev = ctx.textAlign
    ctx.textAlign = 'left'
    chars.forEach((c, i) => {
      ctx.fillText(c, x, y)
      x += widths[i] + gap
    })
    ctx.textAlign = prev
  },

  cornerMark(ctx: any, x: number, y: number, dx: number, dy: number, len: number) {
    ctx.beginPath()
    ctx.moveTo(x + dx * len, y)
    ctx.lineTo(x, y)
    ctx.lineTo(x, y + dy * len)
    ctx.stroke()
  },

  paintSeal(ctx: any, x: number, y: number, size: number) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(-0.12)
    const half = size / 2
    ctx.strokeStyle = 'rgba(166, 48, 38, 0.88)'
    ctx.lineWidth = 2.2
    ctx.strokeRect(-half, -half, size, size)
    ctx.lineWidth = 0.8
    ctx.strokeRect(-half + 3.5, -half + 3.5, size - 7, size - 7)
    ctx.fillStyle = 'rgba(166, 48, 38, 0.9)'
    ctx.font = '12px "Songti SC", "STSong", "PingFang SC", serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const g = size * 0.2
    ctx.fillText('静', -g, -g)
    ctx.fillText('心', g, -g)
    ctx.fillText('印', -g, g)
    ctx.fillText('证', g, g)
    ctx.restore()
  },

  // ===== 保存 / 分享 =====
  saveAlbum() {
    if (!this.data.certPath) {
      wx.showToast({ title: '证书尚未生成', icon: 'none' })
      return
    }
    wx.saveImageToPhotosAlbum({
      filePath: this.data.certPath,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (err: any) => {
        if (err && err.errMsg && err.errMsg.indexOf('auth deny') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中开启「保存到相册」权限',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) wx.openSetting()
            },
          })
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      },
    })
  },

  shareCert() {
    if (!this.data.certPath) {
      wx.showToast({ title: '证书尚未生成', icon: 'none' })
      return
    }
    const anyWx: any = wx
    if (anyWx.shareFileMessage) {
      anyWx.shareFileMessage({
        filePath: this.data.certPath,
        fileName: '心愿证书.png',
        fail: () => {
          wx.showToast({ title: '暂不支持，可截图分享', icon: 'none' })
        },
      })
    } else {
      wx.showToast({ title: '基础库过低，可截图分享', icon: 'none' })
    }
  },
})
