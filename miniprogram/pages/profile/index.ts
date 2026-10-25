// 静心
import {
  fetchProfile,
  updateSettings,
  preparePremiumPay,
  confirmPremiumPay,
  verifyPremium,
  UserSettings,
  settingsOf,
  channelAdminCheck,
} from '../../utils/cloud'
import { AMBIENCE_OPTIONS, AmbienceId, isPremiumAmbience, parseAmbience } from '../../utils/audioCatalog'
import { isPremiumTheme, parseTheme, ThemeId, THEMES } from '../../utils/theme'
import { mockEnabled, mockMarkPaid } from '../../utils/devMock'
import { fmtInt, todayStr, offsetDate, weekdayMon0, fmtMD, concealTabBar } from '../../utils/util'

interface HeatCell {
  key: string
  date: string
  count: number
  level: number
  isToday: boolean
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

interface DressOption {
  id: string
  name: string
  locked: boolean
  /** 主题色块的背景样式；氛围没有 */
  swatch: string
}

function dressList(
  list: { id: string; name: string; premium?: boolean; swatch?: [string, string] }[],
  premium: boolean
): DressOption[] {
  return list.map((item) => ({
    id: item.id,
    name: item.name,
    locked: !!item.premium && !premium,
    swatch: item.swatch ? 'background: linear-gradient(180deg, ' + item.swatch[0] + ' 0%, ' + item.swatch[1] + ' 100%);' : '',
  }))
}

// 普通微信支付走 JSAPI，openid 由云函数从 getWXContext() 直接拿到，
// 不再需要 wx.login 换 session_key（那是虚拟支付做用户态签名才要的）。
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 已付款、但还没确认发货的单号。必须落盘：页面重载或切 tab 后仍能续查，
// 否则页面状态会被服务端值覆盖回“未开通”，用户就会被再次引导去付费。
const PAY_PENDING_KEY = 'premium_pending_order'
const PAY_PENDING_TTL = 7 * 24 * 60 * 60 * 1000

function readPending(): string {
  try {
    const raw = wx.getStorageSync(PAY_PENDING_KEY)
    if (!raw) return ''
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
    const no = String((obj && obj.no) || '')
    const at = Number((obj && obj.at) || 0)
    if (!no || !at) return ''
    if (Date.now() - at > PAY_PENDING_TTL) {
      wx.removeStorageSync(PAY_PENDING_KEY)
      return ''
    }
    return no
  } catch (e) {
    return ''
  }
}

function writePending(no: string) {
  try {
    if (!no) wx.removeStorageSync(PAY_PENDING_KEY)
    else wx.setStorageSync(PAY_PENDING_KEY, JSON.stringify({ no, at: Date.now() }))
  } catch (e) {
    // 存储不可用时退化为仅本次会话有效
  }
}

function devicePlatform(): string {
  try {
    const anyWx: any = wx
    if (typeof anyWx.getDeviceInfo === 'function') {
      const d = anyWx.getDeviceInfo()
      if (d && d.platform) return String(d.platform).toLowerCase()
    }
  } catch {
    // ignore
  }
  try {
    return String((wx.getSystemInfoSync() as any).platform || '').toLowerCase()
  } catch {
    return ''
  }
}

// 普通微信支付（商户号收款）：iOS / Android 完全一致，不经过苹果 App 内支付。
// 参数由 wxpay 云函数用商户私钥签好后下发，前端不参与签名。
function requestPayment(p: {
  timeStamp: string
  nonceStr: string
  package: string
  signType: string
  paySign: string
}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (mockEnabled()) {
      wx.showModal({
        title: '模拟支付',
        content: '本地模拟模式，不会真实扣款',
        confirmText: '支付成功',
        cancelText: '取消',
        success: (r) => {
          if (r.confirm) {
            mockMarkPaid(p.package.replace(/^prepay_id=/, ''))
            resolve()
            return
          }
          const err: any = new Error('已取消')
          err.code = 'cancel'
          reject(err)
        },
        fail: () => {
          const err: any = new Error('已取消')
          err.code = 'cancel'
          reject(err)
        },
      })
      return
    }
    if (devicePlatform() === 'devtools') {
      reject(new Error('请用手机微信打开（开发者工具不支持支付）'))
      return
    }
    wx.requestPayment({
      timeStamp: p.timeStamp,
      nonceStr: p.nonceStr,
      package: p.package,
      signType: p.signType as 'RSA',
      paySign: p.paySign,
      success: () => resolve(),
      fail: (e: any) => {
        const msg = String((e && (e.errMsg || e.message)) || '')
        if (msg.indexOf('cancel') >= 0 || msg.indexOf('取消') >= 0) {
          const err: any = new Error('已取消')
          err.code = 'cancel'
          reject(err)
          return
        }
        reject(new Error(msg.replace(/^requestPayment:fail\s*/i, '') || '支付失败'))
      },
    })
  })
}

function yuanText(fen: number): string {
  if (!(fen > 0)) return ''
  const y = fen / 100
  return Number.isInteger(y) ? String(y) : y.toFixed(2)
}

function levelOfCount(c: number): number {
  if (c <= 0) return 0
  if (c <= 2) return 1
  if (c <= 5) return 2
  if (c <= 9) return 3
  return 4
}

function buildHeat(map: Record<string, number>): HeatCell[][] {
  const today = todayStr()
  const wd = weekdayMon0(today)
  const monday = offsetDate(today, -wd)
  const start = offsetDate(monday, -28) // 5 周前周一
  const rows: HeatCell[][] = []
  for (let w = 0; w < 5; w++) {
    const row: HeatCell[] = []
    for (let c = 0; c < 7; c++) {
      const date = offsetDate(start, w * 7 + c)
      const count = map[date] || 0
      row.push({
        key: date,
        date,
        count,
        level: levelOfCount(count),
        isToday: date === today,
      })
    }
    rows.push(row)
  }
  return rows
}

Page({
  data: {
    statusBarHeight: 20,
    loading: true,
    totalText: '0',
    wishCount: 0,
    streak: 0,
    rate: 0,
    nickname: '',
    rows: [] as HeatCell[][],
    weekdayLabels: WEEKDAY_LABELS,
    selText: '',
    todayLabel: '',
    soundOn: true,
    vibrateOn: true,
    autoMode: false,
    ambience: 'off' as AmbienceId,
    ambienceOptions: dressList(AMBIENCE_OPTIONS, false),
    theme: 'dawn' as ThemeId,
    themeOptions: dressList(THEMES, false),
    premium: false,
    showAdmin: false,
  },

  _alive: false,
  _paying: false,
  _resuming: false,
  _verified: false,

  onLoad() {
    const app = getApp<IAppOption>()
    this._alive = true
    this._paying = false
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    concealTabBar(this)
    this.load()
    this.resumePending()
    this.verifyRefund()
  },

  onUnload() {
    this._alive = false
  },

  // 上一笔付款没能当场确认发货时的续查。每次回到本页都继续追，直到开启或过期，
  // 避免用户在发货到达前被要求再次付费。
  async resumePending() {
    if (this._paying || this._resuming) return
    const no = readPending()
    if (!no) return
    this._resuming = true
    try {
      for (let i = 0; i < 12; i++) {
        if (!this._alive || this.data.premium) return
        const r = await confirmPremiumPay(no)
        if (r.premium) {
          writePending('')
          this.markPremium()
          wx.showToast({ title: '已开启', icon: 'none' })
          return
        }
        await sleep(i < 6 ? 1000 : 2000)
      }
    } catch (e) {
      // 保留挂起状态，下次进入页面再试
    } finally {
      this._resuming = false
    }
  },

  // 退款复核：在商户平台给用户退款后，微信侧订单会变成 REFUND。
  // 我们没接异步回调，所以每次进本页主动问一次微信；确认已退款就收回权益。
  // 每次页面实例只查一次，避免切 tab 时反复请求。
  async verifyRefund() {
    if (this._verified || this._paying || this._resuming) return
    this._verified = true
    try {
      if (!this.data.premium) return
      const r = await verifyPremium()
      if (!this._alive) return
      if (r.refunded) {
        writePending('')
        wx.showToast({ title: '已退款，高级功能已关闭', icon: 'none' })
        this.load()
      }
    } catch (e) {
      // 复核失败不收回权益：网络抖动不应误伤付费用户
    }
  },

  async load() {
    try {
      const res = await fetchProfile()
      if (!this._alive) return
      const done = res.wishes.filter((w) => w.status === 'completed' || w.status === 'fulfilled').length
      const rate = res.wishes.length ? Math.round((done / res.wishes.length) * 100) : 0
      const today = todayStr()
      const rows = buildHeat(res.map || {})
      const todayCount = res.todayCount || 0
      const s = settingsOf(res.user)
      const premium = res.user.premium === true
      if (premium) writePending('')
      this.setData({
        loading: false,
        totalText: fmtInt(res.user.totalMerit || 0),
        wishCount: res.wishes.length,
        streak: res.streak,
        rate,
        nickname: res.user.nickname || '静心的人',
        rows,
        todayLabel: todayCount > 0 ? String(todayCount) : '',
        selText: todayCount > 0 ? today + '  ·  ' + todayCount : today,
        soundOn: s.soundOn,
        vibrateOn: s.vibrateOn,
        autoMode: s.autoMode,
        ambience: s.ambience,
        ambienceOptions: dressList(AMBIENCE_OPTIONS, premium),
        theme: s.theme,
        themeOptions: dressList(THEMES, premium),
        premium,
      })
      this.loadChannelFlags()
    } catch (e: any) {
      if (!this._alive) return
      this.setData({ loading: false })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    }
  },

  onPickCell(e: any) {
    const date = e.currentTarget.dataset.date
    const count = Number(e.currentTarget.dataset.count || 0)
    this.setData({
      selText: count > 0 ? fmtMD(date) + '  ·  ' + count : fmtMD(date),
    })
  },

  // ===== 设置 =====
  toggleSound() {
    this.saveSetting({ soundOn: !this.data.soundOn })
  },
  toggleVibrate() {
    this.saveSetting({ vibrateOn: !this.data.vibrateOn })
  },
  toggleAuto() {
    this.saveSetting({ autoMode: !this.data.autoMode })
  },
  onPickAmbience(e: any) {
    const ambience = parseAmbience(e.currentTarget.dataset.id)
    if (ambience === this.data.ambience) return
    if (isPremiumAmbience(ambience) && !this.data.premium) {
      this.askUnlock()
      return
    }
    this.saveSetting({ ambience })
  },
  onPickTheme(e: any) {
    const theme = parseTheme(e.currentTarget.dataset.id)
    if (theme === this.data.theme) return
    if (isPremiumTheme(theme) && !this.data.premium) {
      this.askUnlock()
      return
    }
    this.saveSetting({ theme })
  },
  askUnlock() {
    this.beginUnlock()
  },

  markPremium() {
    this.setData({
      premium: true,
      ambienceOptions: dressList(AMBIENCE_OPTIONS, true),
      themeOptions: dressList(THEMES, true),
    })
  },

  // 轮询确认发货。wx.requestVirtualPayment 的 success 只代表支付流程结束，
  // 微信的发货推送首推通常在 15s 左右，原来的 7s 窗口几乎必然错过。
  // 这里改为退避轮询，覆盖到约 25s。
  async waitDelivered(outTradeNo: string): Promise<boolean> {
    if (!outTradeNo) return false
    for (let i = 0; i < 20; i++) {
      if (!this._alive) return false
      const r = await confirmPremiumPay(outTradeNo)
      if (r.premium) return true
      await sleep(i < 8 ? 800 : 1500)
    }
    return false
  },

  async beginUnlock() {
    if (this._paying) return
    this._paying = true
    wx.showLoading({ title: '准备中', mask: true })
    try {
      const prep = await preparePremiumPay()
      if (!this._alive) return
      if (prep.premium || prep.already) {
        wx.hideLoading()
        writePending('')
        this.markPremium()
        wx.showToast({ title: '已开启', icon: 'none' })
        return
      }
      if (!prep.timeStamp || !prep.nonceStr || !prep.package || !prep.paySign) {
        throw new Error('支付参数不完整')
      }
      // 关键防重复扣费：本单已经付过款、只是尚未确认发货。
      // 此时 prepare 会复用同一个 outTradeNo，这里必须直接跳到轮询，绝不能再拉起支付。
      if (prep.outTradeNo && readPending() === prep.outTradeNo) {
        wx.hideLoading()
        wx.showLoading({ title: '发放中', mask: true })
        const settled = await this.waitDelivered(prep.outTradeNo)
        wx.hideLoading()
        if (!this._alive) return
        if (settled) {
          writePending('')
          this.markPremium()
          wx.showToast({ title: '已开启', icon: 'none' })
        } else {
          wx.showToast({ title: '付款已收到，正在开启', icon: 'none' })
        }
        return
      }
      const price = yuanText(prep.goodsPrice || 0)
      wx.hideLoading()
      if (price) {
        const go = await new Promise<boolean>((resolve) => {
          wx.showModal({
            title: '一次开启',
            content: '氛围与主题 · ¥' + price,
            confirmText: '支付',
            cancelText: '取消',
            confirmColor: '#e0b577',
            success: (r) => resolve(!!r.confirm),
            fail: () => resolve(false),
          })
        })
        if (!go) return
      }
      await requestPayment({
        timeStamp: prep.timeStamp || '',
        nonceStr: prep.nonceStr || '',
        package: prep.package || '',
        signType: prep.signType || 'RSA',
        paySign: prep.paySign || '',
      })
      if (!this._alive) return
      // 记账：这笔已付款。之后即使页面被重载，也只能续查这一单，不能让 prepare 再开新单。
      writePending(prep.outTradeNo || '')
      wx.showLoading({ title: '发放中', mask: true })
      const ok = await this.waitDelivered(prep.outTradeNo || '')
      wx.hideLoading()
      if (!this._alive) return
      if (ok) {
        writePending('')
        this.markPremium()
        wx.showToast({ title: '已开启', icon: 'none' })
      } else {
        // 不要提示“刷新”：用户在回到本页时会由 resumePending 自动续查
        wx.showToast({ title: '付款已收到，正在开启', icon: 'none' })
      }
    } catch (e: any) {
      wx.hideLoading()
      if (!this._alive) return
      if (e && e.code === 'cancel') return
      wx.showToast({ title: (e && e.message) || '未能开启', icon: 'none' })
    } finally {
      this._paying = false
    }
  },
  saveSetting(patch: Partial<UserSettings>) {
    const prev = {
      soundOn: this.data.soundOn,
      vibrateOn: this.data.vibrateOn,
      autoMode: this.data.autoMode,
      ambience: this.data.ambience,
      theme: this.data.theme,
    }
    this.setData(patch)
    updateSettings(patch).catch((e: any) => {
      if (e && e.code === 'premium') {
        this.setData(prev)
        this.askUnlock()
        return
      }
      wx.showToast({ title: '保存失败', icon: 'none' })
      this.load()
    })
  },

  async loadChannelFlags() {
    try {
      const admin = await channelAdminCheck().catch(() => ({
        isAdmin: false,
        needsBootstrap: false,
      }))
      if (!this._alive) return
      this.setData({
        showAdmin: !!(admin.isAdmin || admin.needsBootstrap),
      })
    } catch (e) {
      // 入口保持隐藏
    }
  },

  async openPartner() {
    wx.navigateTo({ url: '/pages/partner/index' })
  },

  openAdmin() {
    wx.navigateTo({ url: '/pages/partner/admin' })
  },
})
