// 静心包：一次付款开启（users.premium）。付款都在静心页的介绍面板里；香案的定课要开启时也是去那里。
import { preparePremiumPay, confirmPremiumPay, fetchPremiumPrice } from './cloud'
import { mockEnabled, mockMarkPaid } from './devMock'

export const PACK_NAME = '静心包'
export const PACK_DESC = '四种氛围：白噪、溪流、松风、炉火\n三套主题：夜、墨、霞\n两套定课：松间慢叩、夜里收心\n一次开启，永久可用'

// 普通微信支付走 JSAPI，openid 由云函数从 getWXContext() 直接拿到，
// 不再需要 wx.login 换 session_key（那是虚拟支付做用户态签名才要的）。
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 已付款、但还没确认发货的单号。必须落盘：页面重载或切 tab 后仍能续查，
// 否则页面状态会被服务端值覆盖回“未开通”，用户就会被再次引导去付费。
const PAY_PENDING_KEY = 'premium_pending_order'
const PAY_PENDING_TTL = 7 * 24 * 60 * 60 * 1000

export function readPending(): string {
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

export function writePending(no: string) {
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

let priceCache = ''

/** 静心包的价格（元），给介绍面板提前显示；云端没配好或旧版云函数不认这个动作时返回空串 */
export function packPrice(): Promise<string> {
  if (priceCache) return Promise.resolve(priceCache)
  return fetchPremiumPrice()
    .then((r) => {
      priceCache = yuanText(r.price || 0)
      return priceCache
    })
    .catch(() => '')
}

// 轮询确认发货。requestPayment 的 success 只代表支付流程结束，
// 微信的发货推送首推通常在 15s 左右，这里退避轮询，覆盖到约 25s。
async function waitDelivered(outTradeNo: string, alive: () => boolean): Promise<boolean> {
  if (!outTradeNo) return false
  for (let i = 0; i < 20; i++) {
    if (!alive()) return false
    const r = await confirmPremiumPay(outTradeNo)
    if (r.premium) return true
    await sleep(i < 8 ? 800 : 1500)
  }
  return false
}

/** opened 已开启；pending 付了款还在等发货；cancel 用户没付或页面已关 */
export type BuyResult = 'opened' | 'pending' | 'cancel'

let paying = false
let resumeTask: Promise<boolean> | null = null

/** 正在付款：续查、退款复核要避开，免得和这一单抢着改状态 */
export function isPaying(): boolean {
  return paying
}

/** 正在续查上一笔：退款复核要避开 */
export function isResuming(): boolean {
  return !!resumeTask
}

/**
 * 上一笔付了款、当场没等到开启的单，回到香案或静心页时接着查。
 * 两个页面共用同一趟查询，开启时只提示一次；返回是否已开启
 */
export function resumePending(): Promise<boolean> {
  if (paying) return Promise.resolve(false)
  if (resumeTask) return resumeTask
  const no = readPending()
  if (!no) return Promise.resolve(false)
  const run = async (): Promise<boolean> => {
    for (let i = 0; i < 12; i++) {
      if (paying) return false
      const r = await confirmPremiumPay(no)
      if (r.premium) {
        writePending('')
        wx.showToast({ title: PACK_NAME + '已开启', icon: 'none' })
        return true
      }
      await sleep(i < 6 ? 1000 : 2000)
    }
    return false
  }
  const task = run()
    // 查不到或出错都保留挂起的单号，下次回来再试
    .catch(() => false)
    .then((ok) => {
      resumeTask = null
      return ok
    })
  resumeTask = task
  return task
}

/** 走一遍付款。成功、取消都不弹提示，交给调用方；其他错误照常 toast */
export async function buyPremium(alive: () => boolean): Promise<BuyResult> {
  if (paying) return 'cancel'
  paying = true
  wx.showLoading({ title: '准备中', mask: true })
  try {
    const prep = await preparePremiumPay()
    if (!alive()) return 'cancel'
    if (prep.premium || prep.already) {
      wx.hideLoading()
      writePending('')
      return 'opened'
    }
    if (!prep.timeStamp || !prep.nonceStr || !prep.package || !prep.paySign) {
      throw new Error('支付参数不完整')
    }
    // 关键防重复扣费：本单已经付过款、只是尚未确认发货。
    // 此时 prepare 会复用同一个 outTradeNo，这里必须直接跳到轮询，绝不能再拉起支付。
    if (prep.outTradeNo && readPending() === prep.outTradeNo) {
      wx.hideLoading()
      wx.showLoading({ title: '发放中', mask: true })
      const settled = await waitDelivered(prep.outTradeNo, alive)
      wx.hideLoading()
      if (!alive()) return 'cancel'
      if (settled) {
        writePending('')
        return 'opened'
      }
      return 'pending'
    }
    const price = yuanText(prep.goodsPrice || 0)
    wx.hideLoading()
    if (price) {
      const go = await new Promise<boolean>((resolve) => {
        wx.showModal({
          title: PACK_NAME,
          content: PACK_DESC + '\n价格 ¥' + price,
          confirmText: '支付',
          cancelText: '取消',
          confirmColor: '#e0b577',
          success: (r) => resolve(!!r.confirm),
          fail: () => resolve(false),
        })
      })
      if (!go) return 'cancel'
    }
    await requestPayment({
      timeStamp: prep.timeStamp || '',
      nonceStr: prep.nonceStr || '',
      package: prep.package || '',
      signType: prep.signType || 'RSA',
      paySign: prep.paySign || '',
    })
    // 记账：这笔已付款。之后即使页面被重载，也只能续查这一单，不能让 prepare 再开新单。
    // 页面关了也照记，下次进静心页由 resumePending 续查
    writePending(prep.outTradeNo || '')
    if (!alive()) return 'pending'
    wx.showLoading({ title: '发放中', mask: true })
    const ok = await waitDelivered(prep.outTradeNo || '', alive)
    wx.hideLoading()
    if (ok) {
      writePending('')
      return 'opened'
    }
    return 'pending'
  } catch (e: any) {
    wx.hideLoading()
    if (!alive()) return 'cancel'
    if (e && e.code === 'cancel') return 'cancel'
    wx.showToast({ title: (e && e.message) || '未能开启', icon: 'none' })
    return 'cancel'
  } finally {
    paying = false
  }
}
