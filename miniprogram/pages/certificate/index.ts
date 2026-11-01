// 心愿证书（Canvas 绘制，保存相册 / 转发）
import { fetchWishes, Wish } from '../../utils/cloud'
import { fmtInt, winInfo, concealTabBar, sourceLine, cnDate, fmtMD } from '../../utils/util'
import { applyLesson } from '../../utils/lesson'
import { percentOf } from '../../utils/constants'

const CW = 400
const CH = 560
const SERIF = '"Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", serif'
const SANS = '"PingFang SC", "Helvetica Neue", sans-serif'

interface CertInfo {
  _id: string
  name: string
  totalText: string
  /** 亲手 / 燃香 / 自动 的构成，没记来源的旧心愿为空 */
  sourceText: string
  dateText: string
  /** 「圆满之日」或「了结之日」 */
  dateLabel: string
  /** 第几张证书，按圆满先后 */
  serial: string
  /** 名字下的小签：10月20日 圆满 */
  chip: string
}

interface NearVM {
  _id: string
  name: string
  percent: number
  left: string
}

function doneDateOf(w: Wish): string {
  return w.fulfilledDate || w.completedDate || ''
}

/** 证书号按专注圆满的先后编，之后了结也不会让号变 */
function orderKey(w: Wish): string {
  return (w.completedDate || w.fulfilledDate || '') + '|' + w._id
}

/** 证书上画了什么：换了内容（比如刚了结）就得重画 */
function sigOf(c: CertInfo): string {
  return [c._id, c.name, c.totalText, c.sourceText, c.dateLabel, c.dateText, c.serial].join('|')
}

function toCert(w: Wish, order: number): CertInfo {
  const date = doneDateOf(w)
  return {
    _id: w._id,
    name: w.name,
    totalText: fmtInt(Math.min(w.current, w.goal) || w.current),
    sourceText: sourceLine(w),
    dateText: cnDate(date),
    dateLabel: w.status === 'fulfilled' ? '了结之日' : '圆满之日',
    serial: '愿字第 ' + String(order).padStart(3, '0') + ' 号',
    chip: date ? fmtMD(date) : '',
  }
}

/** 证书名字：先试大字，放不下就缩，再放不下就折成两行 */
function fitName(ctx: any, name: string, maxW: number): { lines: string[]; size: number } {
  for (let size = 30; size >= 20; size -= 2) {
    ctx.font = size + 'px ' + SERIF
    if (ctx.measureText(name).width <= maxW) return { lines: [name], size }
  }
  const half = Math.ceil(name.length / 2)
  const lines = [name.slice(0, half), name.slice(half)]
  for (let size = 24; size >= 16; size -= 2) {
    ctx.font = size + 'px ' + SERIF
    if (lines.every((l) => ctx.measureText(l).width <= maxW)) return { lines, size }
  }
  return { lines, size: 16 }
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
    near: null as NearVM | null,
  },

  _alive: false,
  /** 当前 certPath 画的是哪张证书、什么内容 */
  _drawnSig: '',

  onLoad() {
    const app = getApp<IAppOption>()
    this._alive = true
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    concealTabBar(this)
    this.loadCert()
  },

  onUnload() {
    this._alive = false
  },

  async loadCert() {
    try {
      const res = await fetchWishes()
      if (!this._alive) return
      const list = res.wishes || []
      // 证书号按圆满先后编；列表最新的在前
      const done = list
        .filter((w) => w.status === 'completed' || w.status === 'fulfilled')
        .sort((a, b) => (orderKey(a) < orderKey(b) ? -1 : orderKey(a) > orderKey(b) ? 1 : 0))
      const certs = done.map((w, i) => toCert(w, i + 1)).reverse()
      const app = getApp<IAppOption>()
      const focusId = app.globalData.certFocusId
      app.globalData.certFocusId = null
      const keepId = focusId || (this.data.cert && this.data.cert._id)
      const pick = certs.find((c) => c._id === keepId) || certs[0] || null
      if (!pick) {
        this.setData({ loading: false, hasCert: false, certs: [], cert: null, certPath: '', near: this.nearOf(list) })
        return
      }
      const same = !!this.data.certPath && this._drawnSig === sigOf(pick)
      this.setData({ loading: false, hasCert: true, certs, cert: pick, certPath: same ? this.data.certPath : '' })
      if (!same) this.queueDraw(pick)
    } catch (e: any) {
      if (!this._alive) return
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },

  /** 还没有证书时，告诉用户离圆满最近的那个心愿 */
  nearOf(list: Wish[]): NearVM | null {
    const ongoing = list.filter((w) => w.status === 'ongoing' && w.goal > 0)
    if (!ongoing.length) return null
    const best = ongoing.reduce((a, b) => (b.current / b.goal > a.current / a.goal ? b : a))
    return {
      _id: best._id,
      name: best.name,
      percent: percentOf(best.current, best.goal),
      left: fmtInt(Math.max(0, best.goal - best.current)),
    }
  },

  goNear() {
    const n = this.data.near
    if (!n) {
      wx.navigateTo({ url: '/pages/wish-form/index' })
      return
    }
    applyLesson({ mode: 'wish', wishId: n._id, name: n.name })
    getApp<IAppOption>().globalData.homeEnterAnim = true
    concealTabBar(this)
    wx.switchTab({ url: '/pages/home/index' })
  },

  queueDraw(info: CertInfo) {
    wx.nextTick(() => {
      setTimeout(() => {
        if (this._alive) this.drawCert(info)
      }, 60)
    })
  },

  pickCert(e: any) {
    const id = (e.currentTarget.dataset.id as string) || ''
    const pick = this.data.certs.find((c) => c._id === id)
    if (!pick || (this.data.cert && pick._id === this.data.cert._id)) return
    this.setData({ cert: pick, certPath: '' })
    this.queueDraw(pick)
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
            // 画的过程中换了别的证书：这张不要了
            if (!this._alive || !this.data.cert || this.data.cert._id !== info._id) return
            this._drawnSig = sigOf(info)
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
    ivory.addColorStop(0, '#f6eddc')
    ivory.addColorStop(0.45, '#f0e3cc')
    ivory.addColorStop(1, '#e6d3b4')
    ctx.fillStyle = ivory
    ctx.fillRect(0, 0, w, h)

    this.paintGrain(ctx, w, h)
    this.paintWatermark(ctx, w, h)
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

    ctx.strokeStyle = 'rgba(154, 118, 64, 0.9)'
    this.cornerCloud(ctx, 34, 34, 1, 1)
    this.cornerCloud(ctx, w - 34, 34, -1, 1)
    this.cornerCloud(ctx, 34, h - 34, 1, -1)
    this.cornerCloud(ctx, w - 34, h - 34, -1, -1)

    this.paintLotus(ctx, w / 2, 70)

    ctx.fillStyle = inkDeep
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '22px ' + SERIF
    this.fillTracked(ctx, '心愿证书', w / 2, 106, 14)

    ctx.strokeStyle = 'rgba(168, 132, 78, 0.55)'
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(w / 2 - 56, 130)
    ctx.lineTo(w / 2 - 6, 130)
    ctx.moveTo(w / 2 + 6, 130)
    ctx.lineTo(w / 2 + 56, 130)
    ctx.stroke()
    this.diamond(ctx, w / 2, 130, 3, 'rgba(168, 132, 78, 0.8)')

    ctx.fillStyle = mute
    ctx.font = '11px ' + SANS
    this.fillTracked(ctx, info.serial, w / 2, 150, 2)

    ctx.font = '13px ' + SERIF
    this.fillTracked(ctx, '兹证明', w / 2, 188, 10)

    const name = (info.name || '').trim()
    const fit = fitName(ctx, name, w - 110)
    ctx.fillStyle = inkDeep
    ctx.font = fit.size + 'px ' + SERIF
    const nameY = fit.lines.length === 1 ? 236 : 220
    const lineH = fit.size + 8
    fit.lines.forEach((line, i) => ctx.fillText(line, w / 2, nameY + i * lineH))

    // 名字下一道细线，折成两行时跟着往下挪
    const ruleY = Math.max(268, nameY + (fit.lines.length - 1) * lineH + fit.size / 2 + 14)
    ctx.strokeStyle = 'rgba(168, 132, 78, 0.3)'
    ctx.lineWidth = 0.6
    ctx.beginPath()
    ctx.moveTo(w / 2 - 100, ruleY)
    ctx.lineTo(w / 2 + 100, ruleY)
    ctx.stroke()

    ctx.fillStyle = ink
    ctx.font = '14px ' + SERIF
    this.fillTracked(ctx, '于专注之中', w / 2, 308, 4)
    this.fillTracked(ctx, '诚心所至，如愿以偿', w / 2, 334, 3)

    ctx.fillStyle = mute
    ctx.font = '13px ' + SANS
    this.fillTracked(ctx, '共积专注  ' + info.totalText + '  叩', w / 2, 382, 2)
    if (info.sourceText) {
      ctx.font = '11px ' + SANS
      ctx.fillText(info.sourceText, w / 2, 404)
    }

    ctx.textAlign = 'left'
    ctx.fillStyle = mute
    ctx.font = '10px ' + SANS
    this.fillTrackedLeft(ctx, info.dateLabel, 50, h - 84, 3)
    ctx.fillStyle = ink
    ctx.font = '13px ' + SERIF
    ctx.fillText(info.dateText, 50, h - 62)

    this.paintSeal(ctx, w - 84, h - 82, 46)
  },

  paintGrain(ctx: any, w: number, h: number) {
    ctx.save()
    ctx.globalAlpha = 0.035
    ctx.fillStyle = '#6b542e'
    for (let i = 0; i < 520; i++) {
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

  /** 纸心一个极淡的大「愿」字 */
  paintWatermark(ctx: any, w: number, h: number) {
    ctx.save()
    ctx.globalAlpha = 0.045
    ctx.fillStyle = '#8a6a3e'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '230px ' + SERIF
    ctx.fillText('愿', w / 2, h / 2 + 14)
    ctx.restore()
  },

  paintVignette(ctx: any, w: number, h: number) {
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.22, w / 2, h / 2, h * 0.72)
    g.addColorStop(0, 'rgba(80, 52, 24, 0)')
    g.addColorStop(1, 'rgba(80, 52, 24, 0.1)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  },

  /** 一朵线描莲花：三瓣加一道水线 */
  paintLotus(ctx: any, cx: number, cy: number) {
    ctx.save()
    ctx.strokeStyle = 'rgba(160, 120, 62, 0.85)'
    ctx.fillStyle = 'rgba(214, 170, 104, 0.18)'
    ctx.lineWidth = 0.9
    const petal = (angle: number, len: number, wid: number) => {
      ctx.save()
      ctx.translate(cx, cy + 8)
      ctx.rotate(angle)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.quadraticCurveTo(wid, -len * 0.55, 0, -len)
      ctx.quadraticCurveTo(-wid, -len * 0.55, 0, 0)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
    petal(-0.62, 15, 6)
    petal(0.62, 15, 6)
    petal(-0.3, 19, 7)
    petal(0.3, 19, 7)
    petal(0, 22, 8)
    ctx.beginPath()
    ctx.moveTo(cx - 22, cy + 10)
    ctx.quadraticCurveTo(cx, cy + 14, cx + 22, cy + 10)
    ctx.stroke()
    ctx.restore()
  },

  /** 四角的云头纹：一道折角 + 一个小卷 */
  cornerCloud(ctx: any, x: number, y: number, dx: number, dy: number) {
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(x + dx * 26, y)
    ctx.lineTo(x, y)
    ctx.lineTo(x, y + dy * 26)
    ctx.stroke()
    ctx.lineWidth = 0.9
    ctx.beginPath()
    ctx.arc(x + dx * 8, y + dy * 8, 4, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x + dx * 8, y + dy * 8, 1.4, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(154, 118, 64, 0.8)'
    ctx.fill()
  },

  diamond(ctx: any, x: number, y: number, r: number, color: string) {
    ctx.save()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(x, y - r)
    ctx.lineTo(x + r, y)
    ctx.lineTo(x, y + r)
    ctx.lineTo(x - r, y)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  },

  fillTracked(ctx: any, text: string, cx: number, y: number, gap: number) {
    const chars = text.split('')
    const widths = chars.map((c) => ctx.measureText(c).width)
    let total = gap * Math.max(0, chars.length - 1)
    widths.forEach((n) => {
      total += n
    })
    this.drawTracked(ctx, chars, widths, cx - total / 2, y, gap)
  },

  fillTrackedLeft(ctx: any, text: string, x: number, y: number, gap: number) {
    const chars = text.split('')
    const widths = chars.map((c) => ctx.measureText(c).width)
    this.drawTracked(ctx, chars, widths, x, y, gap)
  },

  drawTracked(ctx: any, chars: string[], widths: number[], x: number, y: number, gap: number) {
    const prev = ctx.textAlign
    ctx.textAlign = 'left'
    chars.forEach((c, i) => {
      ctx.fillText(c, x, y)
      x += widths[i] + gap
    })
    ctx.textAlign = prev
  },

  /** 白文方印「静心印证」：朱底，字留白，边上有点斑驳 */
  paintSeal(ctx: any, x: number, y: number, size: number) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(-0.1)
    const half = size / 2
    ctx.fillStyle = 'rgba(176, 46, 34, 0.9)'
    ctx.beginPath()
    const r = 3
    ctx.moveTo(-half + r, -half)
    ctx.lineTo(half - r, -half)
    ctx.quadraticCurveTo(half, -half, half, -half + r)
    ctx.lineTo(half, half - r)
    ctx.quadraticCurveTo(half, half, half - r, half)
    ctx.lineTo(-half + r, half)
    ctx.quadraticCurveTo(-half, half, -half, half - r)
    ctx.lineTo(-half, -half + r)
    ctx.quadraticCurveTo(-half, -half, -half + r, -half)
    ctx.fill()
    // 印泥不匀：撒几点纸色
    ctx.fillStyle = 'rgba(240, 227, 204, 0.55)'
    for (let i = 0; i < 26; i++) {
      const px = ((i * 37) % size) - half
      const py = ((i * 23) % size) - half
      ctx.fillRect(px, py, 0.9, 0.9)
    }
    ctx.strokeStyle = 'rgba(244, 232, 210, 0.85)'
    ctx.lineWidth = 0.8
    ctx.strokeRect(-half + 3, -half + 3, size - 6, size - 6)
    ctx.fillStyle = 'rgba(248, 238, 220, 0.95)'
    ctx.font = 'bold 15px ' + SERIF
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const g = size * 0.21
    // 印文从右往左竖读：静心 / 印证
    ctx.fillText('静', g, -g)
    ctx.fillText('心', g, g)
    ctx.fillText('印', -g, -g)
    ctx.fillText('证', -g, g)
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
        } else if (!(err && err.errMsg && err.errMsg.indexOf('cancel') >= 0)) {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      },
    })
  },

  /** 优先用图片分享菜单（发给朋友、朋友圈、收藏一并给）；老基础库退回发文件 */
  shareCert() {
    if (!this.data.certPath) {
      wx.showToast({ title: '证书尚未生成', icon: 'none' })
      return
    }
    const anyWx: any = wx
    if (typeof anyWx.showShareImageMenu === 'function') {
      anyWx.showShareImageMenu({
        path: this.data.certPath,
        fail: (e: any) => {
          if (e && e.errMsg && e.errMsg.indexOf('cancel') >= 0) return
          wx.showToast({ title: '暂不支持，可长按图片转发', icon: 'none' })
        },
      })
      return
    }
    if (anyWx.shareFileMessage) {
      anyWx.shareFileMessage({
        filePath: this.data.certPath,
        fileName: '心愿证书.png',
        fail: () => {
          wx.showToast({ title: '暂不支持，可长按图片转发', icon: 'none' })
        },
      })
    } else {
      wx.showToast({ title: '基础库过低，可长按图片转发', icon: 'none' })
    }
  },

  onShareAppMessage() {
    const c = this.data.cert
    return {
      title: c ? '「' + c.name + '」心愿圆满，共积 ' + c.totalText + ' 叩' : '小叩木鱼 · 轻叩一声，万缘放下',
      path: '/pages/gate/index',
    }
  },
})
