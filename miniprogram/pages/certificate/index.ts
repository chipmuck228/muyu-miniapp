// 功德证书（Canvas 绘制，保存相册 / 转发）
import { fetchWishes } from '../../utils/cloud'
import { fmtInt, fmtFullCN, winInfo, concealTabBar } from '../../utils/util'

const CW = 400
const CH = 300

interface CertInfo {
  _id: string
  name: string
  totalText: string
  dateText: string
}

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    hasCert: false,
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
      const pick = fulfilled[0] || completed[0] || null
      if (!pick) {
        this.setData({ loading: false, hasCert: false, cert: null, certPath: '' })
        return
      }
      const info: CertInfo = {
        _id: pick._id,
        name: pick.name,
        totalText: fmtInt(pick.current),
        dateText: fmtFullCN(pick.fulfilledDate || pick.completedDate || ''),
      }
      this.setData({ loading: false, hasCert: true, cert: info, certPath: '' })
      // 等 canvas 渲染后绘制
      wx.nextTick(() => {
        setTimeout(() => this.drawCert(info), 60)
      })
    } catch (e: any) {
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
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
    // 背景：古纸米黄渐变
    const bg = ctx.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, '#f5e6d3')
    bg.addColorStop(1, '#e8d5c0')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    // 水印
    ctx.save()
    ctx.globalAlpha = 0.05
    ctx.fillStyle = '#8B6B4A'
    ctx.font = '64px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('◈', w / 2, h / 2 + 6)
    ctx.restore()

    // 边框
    ctx.lineWidth = 3
    ctx.strokeStyle = '#c9a96e'
    ctx.strokeRect(6, 6, w - 12, h - 12)
    ctx.lineWidth = 1
    ctx.strokeStyle = '#d4a574'
    ctx.strokeRect(11, 11, w - 22, h - 22)

    // 四角装饰：顶部两侧与底部两侧的小圆弧
    ctx.save()
    ctx.strokeStyle = '#c9a96e'
    ctx.lineWidth = 2
    const cx = w / 2
    const yTop = 24
    const yBottom = h - 24
    this.cornerArc(ctx, cx - 80, yTop, 0, Math.PI)
    this.cornerArc(ctx, cx + 80, yTop, 0, Math.PI)
    this.cornerArc(ctx, cx - 80, yBottom, Math.PI, 2 * Math.PI)
    this.cornerArc(ctx, cx + 80, yBottom, Math.PI, 2 * Math.PI)
    ctx.restore()

    // 标题
    ctx.fillStyle = '#8B6B4A'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.font = 'bold 30px "PingFang SC", sans-serif'
    ctx.fillText('功 德 证 书', w / 2, 66)

    // 副标题线
    ctx.strokeStyle = '#d4a574'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(w / 2 - 70, 82)
    ctx.lineTo(w / 2 + 70, 82)
    ctx.stroke()

    // 正文
    ctx.fillStyle = '#6b4a2c'
    ctx.font = '13px "PingFang SC", sans-serif'
    ctx.fillText('兹  证  明', w / 2, 122)

    // 心愿名
    let name = info.name
    if (name.length > 12) name = name.slice(0, 11) + '…'
    ctx.fillStyle = '#a05a24'
    ctx.font = 'bold 22px "PingFang SC", sans-serif'
    ctx.fillText('「 ' + name + ' 」', w / 2, 165)

    ctx.fillStyle = '#7a5a38'
    ctx.font = '12px "PingFang SC", sans-serif'
    ctx.fillText('于禅心修行中，诚心所至，如愿圆满', w / 2, 196)

    // 功德数与日期
    ctx.font = 'bold 14px "PingFang SC", sans-serif'
    ctx.fillStyle = '#8a3a1a'
    ctx.fillText('共 积 功 德 ' + info.totalText, w / 2, 232)

    ctx.font = '12px "PingFang SC", sans-serif'
    ctx.fillStyle = '#7a5a38'
    ctx.fillText(info.dateText + ' 圆满', w / 2, 254)

    // 印章
    this.paintSeal(ctx, w - 66, h - 62, 26)
  },

  cornerArc(ctx: any, x: number, y: number, s: number, e: number) {
    ctx.beginPath()
    ctx.arc(x, y, 26, s, e)
    ctx.stroke()
  },

  paintSeal(ctx: any, x: number, y: number, r: number) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(-0.18)
    // 外圈
    ctx.strokeStyle = 'rgba(176,58,46,0.9)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.stroke()
    // 齿轮边小刻线（示意）
    ctx.lineWidth = 1.5
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * (r - 4), Math.sin(a) * (r - 4))
      ctx.lineTo(Math.cos(a) * (r - 1), Math.sin(a) * (r - 1))
      ctx.stroke()
    }
    // 文字 禅心 / 印证
    ctx.fillStyle = 'rgba(176,58,46,0.92)'
    ctx.font = 'bold 11px "PingFang SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('禅', -5.5, -6)
    ctx.fillText('印', 6.5, -6)
    ctx.fillText('心', -5.5, 7)
    ctx.fillText('证', 6.5, 7)
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
        fileName: '功德证书.png',
        fail: () => {
          wx.showToast({ title: '暂不支持，可截图分享', icon: 'none' })
        },
      })
    } else {
      wx.showToast({ title: '基础库过低，可截图分享', icon: 'none' })
    }
  },
})
