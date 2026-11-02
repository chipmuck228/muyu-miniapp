// 本地模拟云函数：没有云开发环境权限时，用本地存储模拟 login / fetch / hit / wish / user，方便调界面和流程。
// 只在开发版生效（体验版、正式版永远走云端）。
// 开关：开发者工具「添加编译模式」→ 启动参数填 mock=1（开）/ mock=0（关）/ mock=reset（重置示例数据）。
// 也可以在调试器 Console 里执行 wx.setStorageSync('muyu_mock_cloud', 1) 后重新编译。
// 完成心愿的惊喜壁纸：用 miniprogram/dev-papers/ 里的本地占位图（scripts/gen-dev-papers.py 生成，不上传）。
// 示例数据里有五个「试壁纸」心愿，每档一个、都差一下圆满；启动参数 papers=1 可把它们恢复成未完成并重抽壁纸。
// 付费功能：点灰色的氛围 / 主题会走模拟支付（弹窗选成功或取消，不真扣款）。
// 也可以用启动参数直接切换：premium=1（已开启）/ premium=0（未开启）/ premium=refund（模拟已退款，进静心页时收回）。

const FLAG_KEY = 'muyu_mock_cloud'
const DB_KEY = 'muyu_mock_db'
const PREMIUM_PRICE = 600
const LATENCY_MS = 160

const DEFAULT_SETTINGS = { soundOn: true, vibrateOn: true, autoMode: false, ambience: 'off', theme: 'dawn' }
const FREE_AMBIENCE: Record<string, 1> = { off: 1, rain: 1, bowl: 1 }
const PREMIUM_AMBIENCE: Record<string, 1> = { noise: 1, stream: 1, pine: 1, fire: 1 }
const FREE_THEME: Record<string, 1> = { dawn: 1 }
const PREMIUM_THEME: Record<string, 1> = { night: 1, ink: 1, dusk: 1 }

// 与 cloudfunctions/{fetch,wish}/papers.js 的档位一致
const PAPER_TIERS = [
  { id: 'su', max: 99 },
  { id: 'ya', max: 499 },
  { id: 'jing', max: 999 },
  { id: 'zhen', max: 4999 },
  { id: 'ji', max: Infinity },
]
const PAPER_DIR = '/dev-papers/'

function tierOfGoal(goal: number): string {
  for (let i = 0; i < PAPER_TIERS.length; i++) {
    if (goal <= PAPER_TIERS[i].max) return PAPER_TIERS[i].id
  }
  return 'ji'
}

function pickPaper(goal: number): { paperId: string; paperTier: string } {
  const tier = tierOfGoal(goal)
  return { paperId: tier + '-' + (Math.random() < 0.5 ? 1 : 2), paperTier: tier }
}

function isDone(w: any): boolean {
  return w.status === 'completed' || w.status === 'fulfilled'
}

/** 和云端一样：抽中的是哪张不下发，只给 hasSurprise */
function publicWish(w: any): any {
  if (!w) return w
  const out = Object.assign({}, w, { hasSurprise: true })
  delete out.paperId
  delete out.paperTier
  return out
}

interface MockDb {
  seq: number
  user: any
  wishes: any[]
  /** 日期 → 当天敲击次数 */
  daily: Record<string, number>
  /** 模拟支付订单：outTradeNo → 状态 */
  orders?: Record<string, 'created' | 'paid'>
  /** premium=refund 时置位，下一次 verify 收回权益 */
  refundPending?: boolean
  /** 已放入过试壁纸心愿 */
  paperTests?: boolean
  /** 最近记过的敲击批号，和云端一样去重 */
  batches?: string[]
}

let enabled: boolean | null = null

function isDevelop(): boolean {
  try {
    const info: any = wx.getAccountInfoSync()
    return !!(info && info.miniProgram && info.miniProgram.envVersion === 'develop')
  } catch {
    return false
  }
}

/** 读启动参数里的 mock=1 / 0 / reset 和 premium=1 / 0 / refund，写进本地存储。App onLaunch 调用。 */
export function applyMockLaunch(query: Record<string, any> | undefined) {
  enabled = null
  if (!query || !isDevelop()) return
  const v = query.mock
  if (v !== undefined && v !== null) {
    try {
      if (v === '0') {
        wx.removeStorageSync(FLAG_KEY)
      } else {
        wx.setStorageSync(FLAG_KEY, 1)
        if (v === 'reset') wx.removeStorageSync(DB_KEY)
      }
    } catch {
      // ignore
    }
  }
  if (!mockEnabled()) return
  const p = query.premium
  if (p !== undefined && p !== null) {
    const db = load()
    db.user.premium = p !== '0'
    db.refundPending = p === 'refund'
    db.orders = {}
    save(db)
  }
  if (query.papers !== undefined && query.papers !== null) {
    const db = load()
    resetPaperTests(db)
    save(db)
  }
}

export function mockEnabled(): boolean {
  if (enabled !== null) return enabled
  let on = false
  try {
    on = isDevelop() && !!wx.getStorageSync(FLAG_KEY)
  } catch {
    on = false
  }
  enabled = on
  return on
}

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

function dateStr(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function daysAgo(today: string, n: number): string {
  const d = new Date(today + 'T00:00:00')
  d.setDate(d.getDate() - n)
  return dateStr(d)
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

function dressSettings(raw: any, premium: boolean) {
  const s = Object.assign({}, DEFAULT_SETTINGS, raw || {})
  const ambienceOk = FREE_AMBIENCE[s.ambience] || (premium && PREMIUM_AMBIENCE[s.ambience])
  const themeOk = FREE_THEME[s.theme] || (premium && PREMIUM_THEME[s.theme])
  return {
    soundOn: typeof s.soundOn === 'boolean' ? s.soundOn : true,
    vibrateOn: typeof s.vibrateOn === 'boolean' ? s.vibrateOn : true,
    autoMode: s.autoMode === true,
    ambience: ambienceOk ? s.ambience : 'off',
    theme: themeOk ? s.theme : 'dawn',
  }
}

function publicUser(u: any) {
  const premium = u.premium === true
  return Object.assign({}, u, { premium, settings: dressSettings(u.settings, premium) })
}

function hitLogOf(today: string, counts: number[]): { date: string; count: number }[] {
  const out: { date: string; count: number }[] = []
  for (let i = counts.length - 1; i >= 0; i--) {
    if (counts[i] > 0) out.push({ date: daysAgo(today, i), count: counts[i] })
  }
  return out
}

function seed(): MockDb {
  const today = dateStr(new Date())
  const daily: Record<string, number> = {}
  const pattern = [0, 8, 24, 0, 46, 12, 30, 64, 0, 18, 52, 96, 22, 0, 40, 74, 10, 0, 58, 120, 36, 14, 0, 88, 42, 26, 60, 110, 48]
  pattern.forEach((n, i) => {
    if (n > 0) daily[daysAgo(today, pattern.length - i)] = n
  })
  const wish = (id: string, name: string, current: number, goal: number, ageDays: number, extra: any = {}) =>
    Object.assign(
      {
        _id: id,
        name,
        goal,
        current,
        deadline: null,
        status: 'ongoing',
        createdAt: Date.now() - ageDays * 86400000,
        // 示例记录放在昨天和前天，和 daily 一致（今天从 0 开始）
        hitLog: hitLogOf(today, [0, Math.min(current, 40), Math.min(Math.max(0, current - 40), 60)]),
      },
      pickPaper(goal),
      extra
    )
  return {
    seq: 100,
    user: {
      _id: 'mock-openid',
      nickname: '静心的人',
      totalMerit: 5746,
      premium: false,
      createdAt: Date.now() - 40 * 86400000,
      lastHitDate: null,
      settings: Object.assign({}, DEFAULT_SETTINGS),
    },
    // 按 createdAt 倒序，和云端一致
    wishes: [
      wish('mock-w1', '差三下就圆满', 7, 10, 1),
      wish('mock-w2', '顺利上岸', 326, 1000, 5, { deadline: daysAgo(today, -56) }),
      wish('mock-w3', '父母康健', 4820, 5000, 20),
      wish('mock-w4', '戒断妄念', 100, 100, 30, {
        status: 'completed',
        completedDate: daysAgo(today, 12),
      }),
    ].concat(paperTestWishes()),
    daily,
    paperTests: true,
  }
}

const PAPER_TEST_GOALS: [string, number][] = [
  ['素', 10],
  ['雅', 100],
  ['净', 500],
  ['真', 1000],
  ['极', 5000],
]

/** 每档一个差一下圆满的心愿，专门用来看惊喜壁纸 */
function paperTestWishes(): any[] {
  const today = dateStr(new Date())
  const now = Date.now()
  return PAPER_TEST_GOALS.map(([tier, goal], i) =>
    Object.assign(
      {
        _id: 'mock-paper-' + i,
        name: '试壁纸 · ' + tier,
        goal,
        current: goal - 1,
        deadline: null,
        status: 'ongoing',
        // 排在列表最前，素在最上
        createdAt: now + (PAPER_TEST_GOALS.length - i),
        hitLog: hitLogOf(today, [0, goal - 1]),
      },
      pickPaper(goal)
    )
  )
}

function resetPaperTests(db: MockDb) {
  db.wishes = db.wishes.filter((w) => String(w._id).indexOf('mock-paper-') !== 0).concat(paperTestWishes())
  db.paperTests = true
}

function load(): MockDb {
  try {
    const v = wx.getStorageSync(DB_KEY)
    if (v && v.user && Array.isArray(v.wishes)) {
      // 旧的模拟数据没有壁纸，补上
      v.wishes.forEach((w: any) => {
        if (!w.paperId) Object.assign(w, pickPaper(w.goal))
      })
      if (!v.paperTests) {
        resetPaperTests(v)
        save(v)
      }
      return v
    }
  } catch {
    // 读坏了就重来
  }
  const db = seed()
  save(db)
  return db
}

function save(db: MockDb) {
  try {
    wx.setStorageSync(DB_KEY, db)
  } catch {
    // ignore
  }
}

function calcStreak(map: Record<string, number>, today: string): number {
  let streak = 0
  let offset = map[today] ? 0 : 1
  while (map[daysAgo(today, offset)] > 0) {
    streak += 1
    offset += 1
  }
  return streak
}

function sortedWishes(db: MockDb): any[] {
  return db.wishes
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(publicWish)
}

function validDate(s: any): boolean {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

function fail(msg: string, code?: string) {
  return code ? { ok: false, msg, code } : { ok: false, msg }
}

function handle(name: string, data: any): any {
  const db = load()
  const today = validDate(data && data.date) ? data.date : dateStr(new Date())

  if (name === 'login') {
    return { ok: true, openid: db.user._id, user: publicUser(db.user) }
  }

  if (name === 'fetch') {
    const action = data && data.action
    const wishes = sortedWishes(db)
    if (action === 'home') {
      return {
        ok: true,
        user: publicUser(db.user),
        activeWish: wishes.find((w) => w.status === 'ongoing') || null,
        completedWish: wishes.find((w) => w.status === 'completed') || null,
        streak: calcStreak(db.daily, today),
        todayCount: db.daily[today] || 0,
        serverNow: Date.now(),
      }
    }
    if (action === 'wishes') return { ok: true, user: publicUser(db.user), wishes }
    if (action === 'detail') {
      const w = db.wishes.find((x) => x._id === (data && data.wishId))
      if (!w) return fail('心愿不存在')
      const out = publicWish(w)
      // 进行中的也给：香案背景随进度从雾里显出它
      if (w.paperId) out.thumbUrl = PAPER_DIR + w.paperId + '-thumb.jpg'
      return { ok: true, wish: out }
    }
    if (action === 'profile') {
      return {
        ok: true,
        user: publicUser(db.user),
        wishes,
        map: db.daily,
        streak: calcStreak(db.daily, today),
        todayCount: db.daily[today] || 0,
      }
    }
    return fail('未知操作')
  }

  if (name === 'hit') {
    const action = (data && data.action) || 'knock'
    const credit = (wishId: string | null, n: number, by: Record<string, number> | null) => {
      db.user.totalMerit = (db.user.totalMerit || 0) + n
      db.user.lastHitDate = today
      db.daily[today] = (db.daily[today] || 0) + n
      let wish = null
      const w = wishId ? db.wishes.find((x) => x._id === wishId) : null
      if (w && w.status === 'ongoing') {
        w.current = (w.current || 0) + n
        const log = w.hitLog.find((h: any) => h.date === today)
        if (log) log.count += n
        else w.hitLog.push({ date: today, count: n })
        if (by) {
          const src = Object.assign({ hand: 0, auto: 0, incense: 0 }, w.bySource || {})
          Object.keys(by).forEach((k) => {
            src[k] = (src[k] || 0) + by[k]
          })
          w.bySource = src
        }
        if (w.current >= w.goal) {
          w.status = 'completed'
          w.completedDate = today
        }
        wish = publicWish(w)
      }
      save(db)
      return { totalMerit: db.user.totalMerit, todayCount: db.daily[today], wish }
    }
    if (action === 'knock') {
      const raw = data && data.by
      const clampN = (v: any) => Math.max(0, Math.min(999, parseInt(v, 10) || 0))
      let by: Record<string, number> | null = null
      if (raw && typeof raw === 'object' && clampN(raw.hand) + clampN(raw.auto) > 0) {
        by = { hand: clampN(raw.hand), auto: clampN(raw.auto) }
      }
      const rawN = parseInt(data && data.n, 10)
      const n = by ? by.hand + by.auto : Math.max(1, Math.min(999, isNaN(rawN) ? 1 : rawN))
      const batchId = data && typeof data.batchId === 'string' ? data.batchId : ''
      const seen = (db.batches = db.batches || [])
      if (batchId && seen.indexOf(batchId) >= 0) {
        return { ok: true, duplicate: true, totalMerit: db.user.totalMerit, todayCount: db.daily[today] || 0, wish: null }
      }
      if (batchId) {
        seen.push(batchId)
        if (seen.length > 30) seen.splice(0, seen.length - 30)
      }
      return Object.assign({ ok: true }, credit((data && data.wishId) || null, n, by))
    }
    return fail('未知操作')
  }

  if (name === 'wish') {
    const action = data && data.action
    const nameText = String((data && data.name) || '').trim()
    const goal = parseInt(data && data.goal, 10)
    if (action === 'create' || action === 'update') {
      if (!nameText) return fail('请填写心愿名称')
      if (!goal || goal < 1) return fail('专注目标需为不小于 1 的整数')
    }
    if (action === 'create') {
      db.seq += 1
      const id = 'mock-w' + db.seq
      db.wishes.push({
        _id: id,
        name: nameText.slice(0, 20),
        goal,
        current: 0,
        deadline: validDate(data.deadline) ? data.deadline : null,
        status: 'ongoing',
        createdAt: Date.now(),
        hitLog: [],
        ...pickPaper(goal),
      })
      save(db)
      return { ok: true, wishId: id }
    }
    const w = db.wishes.find((x) => x._id === (data && data.wishId))
    if (!w) return fail('心愿不存在')
    if (action === 'update') {
      w.name = nameText.slice(0, 20)
      // 改了目标跨档才重抽壁纸，和云端一致
      if (tierOfGoal(goal) !== w.paperTier) Object.assign(w, pickPaper(goal))
      w.goal = goal
      w.deadline = validDate(data.deadline) ? data.deadline : null
      save(db)
      return { ok: true, wishId: w._id }
    }
    if (action === 'fulfill') {
      if (w.status !== 'fulfilled') {
        w.status = 'fulfilled'
        w.fulfilledDate = today
        save(db)
      }
      return { ok: true, wish: publicWish(w) }
    }
    if (action === 'remove') {
      db.wishes = db.wishes.filter((x) => x !== w)
      save(db)
      return { ok: true }
    }
    if (action === 'paperOrigin') {
      if (!isDone(w)) return fail('心愿尚未完成')
      return { ok: true, originUrl: '', originFileId: '', localPath: PAPER_DIR + w.paperId + '.jpg' }
    }
    return fail('未知操作')
  }

  if (name === 'user') {
    if (data && data.action === 'profile') {
      const p = (data && data.profile) || {}
      if (typeof p.nickname === 'string') db.user.nickname = p.nickname.trim().slice(0, 20) || '静心的人'
      if (typeof p.wechatId === 'string') db.user.wechatId = p.wechatId.trim().slice(0, 40)
      if (typeof p.avatarFileID === 'string') db.user.avatarFileID = p.avatarFileID.trim()
      save(db)
      return {
        ok: true,
        user: {
          nickname: db.user.nickname,
          wechatId: db.user.wechatId || '',
          avatarFileID: db.user.avatarFileID || '',
        },
      }
    }
    const patch = (data && data.settings) || {}
    const premium = db.user.premium === true
    if (!premium && (PREMIUM_AMBIENCE[patch.ambience] || PREMIUM_THEME[patch.theme])) {
      return fail('开启静心包后可用', 'premium')
    }
    const next: any = {}
    if (typeof patch.soundOn === 'boolean') next.soundOn = patch.soundOn
    if (typeof patch.vibrateOn === 'boolean') next.vibrateOn = patch.vibrateOn
    if (typeof patch.autoMode === 'boolean') next.autoMode = patch.autoMode
    if (FREE_AMBIENCE[patch.ambience] || PREMIUM_AMBIENCE[patch.ambience]) next.ambience = patch.ambience
    if (FREE_THEME[patch.theme] || PREMIUM_THEME[patch.theme]) next.theme = patch.theme
    db.user.settings = Object.assign({}, DEFAULT_SETTINGS, db.user.settings || {}, next)
    save(db)
    return { ok: true, settings: dressSettings(db.user.settings, premium), premium }
  }

  if (name === 'wxpay') {
    const action = (data && data.action) || 'prepay'
    const orders = (db.orders = db.orders || {})
    if (action === 'prepay') {
      if (db.user.premium === true) return { ok: true, premium: true, already: true }
      // 和云端一样：已付款未发货的单复用同一个单号，前端据此只轮询不再拉起支付
      const paid = Object.keys(orders).find((k) => orders[k] === 'paid')
      let no = paid
      if (!no) {
        db.seq += 1
        no = 'mock-order-' + db.seq
        orders[no] = 'created'
        save(db)
      }
      return {
        ok: true,
        premium: false,
        outTradeNo: no,
        goodsPrice: PREMIUM_PRICE,
        timeStamp: String(Math.floor(Date.now() / 1000)),
        nonceStr: 'mock',
        package: 'prepay_id=' + no,
        signType: 'RSA',
        paySign: 'mock',
      }
    }
    if (action === 'query') {
      const no = data && data.outTradeNo
      // 模拟发货推送：已付款的单在查询时发货
      if (no && orders[no] === 'paid') {
        db.user.premium = true
        delete orders[no]
        save(db)
      }
      return { ok: true, premium: db.user.premium === true }
    }
    if (action === 'price') return { ok: true, price: PREMIUM_PRICE }
    if (action === 'verify') {
      if (db.refundPending && db.user.premium === true) {
        db.user.premium = false
        db.refundPending = false
        save(db)
        return { ok: true, premium: false, refunded: true }
      }
      return { ok: true, premium: db.user.premium === true, refunded: false }
    }
    return fail('未知操作')
  }
  if (name === 'checkChannelAuth') return { ok: true, isChannel: false }
  if (name === 'bindChannel') return { ok: true, bound: false, reason: 'mock' }
  if (name === 'channelAdmin' && data && data.action === 'check') {
    return { ok: true, isAdmin: false, needsBootstrap: false }
  }
  if (name === 'getChannelStats') {
    // 本地预览用：一条带昵称、一条未填资料，方便验证头像占位与昵称回退
    const nick = String(db.user.nickname || '').trim()
    const q = String((data && data.wechatId) || '').trim().toLowerCase()
    const rows = [
      { id: 'mock-u1', wechatId: nick && nick !== '静心的人' ? nick : 'A1B2C3D4', nickname: nick && nick !== '静心的人' ? nick : '', avatarUrl: '', boundAt: Date.now() - 86400000, paid: db.user.premium === true },
      { id: 'mock-u2', wechatId: '9F8E7D6C', nickname: '', avatarUrl: '', boundAt: Date.now() - 2 * 86400000, paid: false },
    ].filter((u) => !q || (u.wechatId + u.nickname).toLowerCase().indexOf(q) >= 0)
    return {
      ok: true,
      name: '本地模拟渠道',
      status: 'active',
      userCount: rows.length,
      paidCount: rows.filter((r) => r.paid).length,
      totalCommission: 0,
      pendingCommission: 0,
      users: rows,
    }
  }

  return fail('本地模式不支持')
}

/** 模拟 wx.requestPayment 成功：把订单标成已付款，之后 query 时发货。 */
export function mockMarkPaid(outTradeNo: string) {
  const db = load()
  db.orders = db.orders || {}
  if (db.orders[outTradeNo]) {
    db.orders[outTradeNo] = 'paid'
    save(db)
  }
}

/** 和 wx.cloud.callFunction 同形：resolve { result } */
export function mockCallFunction(name: string, data: Record<string, any>): Promise<{ result: any }> {
  return new Promise((resolve) => {
    setTimeout(() => {
      let result: any
      try {
        result = clone(handle(name, data || {}))
      } catch (e: any) {
        result = fail((e && e.message) || '本地模拟出错')
      }
      resolve({ result })
    }, LATENCY_MS)
  })
}
