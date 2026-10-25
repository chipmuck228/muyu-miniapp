// 本地模拟云函数：没有云开发环境权限时，用本地存储模拟 login / fetch / hit / wish / user，方便调界面和流程。
// 只在开发版生效（体验版、正式版永远走云端）。
// 开关：开发者工具「添加编译模式」→ 启动参数填 mock=1（开）/ mock=0（关）/ mock=reset（重置示例数据）。
// 也可以在调试器 Console 里执行 wx.setStorageSync('muyu_mock_cloud', 1) 后重新编译。
// 想测付费主题：在 Storage 面板把 muyu_mock_db.user.premium 改成 true。

const FLAG_KEY = 'muyu_mock_cloud'
const DB_KEY = 'muyu_mock_db'
const LATENCY_MS = 160

const DEFAULT_SETTINGS = { soundOn: true, vibrateOn: true, autoMode: false, ambience: 'off', theme: 'dawn' }
const FREE_AMBIENCE: Record<string, 1> = { off: 1, rain: 1, bowl: 1 }
const PREMIUM_AMBIENCE: Record<string, 1> = { noise: 1, stream: 1, pine: 1, fire: 1 }
const FREE_THEME: Record<string, 1> = { dawn: 1 }
const PREMIUM_THEME: Record<string, 1> = { night: 1, ink: 1, dusk: 1 }

interface MockDb {
  seq: number
  user: any
  wishes: any[]
  /** 日期 → 当天敲击次数 */
  daily: Record<string, number>
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

/** 读启动参数里的 mock=1 / 0 / reset，写进本地开关。App onLaunch 调用。 */
export function applyMockLaunch(query: Record<string, any> | undefined) {
  enabled = null
  const v = query && query.mock
  if (v === undefined || v === null || !isDevelop()) return
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
        hasSurprise: true,
      }),
    ],
    daily,
  }
}

function load(): MockDb {
  try {
    const v = wx.getStorageSync(DB_KEY)
    if (v && v.user && Array.isArray(v.wishes)) return v
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
  return db.wishes.slice().sort((a, b) => b.createdAt - a.createdAt)
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
      }
    }
    if (action === 'wishes') return { ok: true, user: publicUser(db.user), wishes }
    if (action === 'detail') {
      const w = db.wishes.find((x) => x._id === (data && data.wishId))
      // 本地没有壁纸文件，thumbUrl 留空
      return w ? { ok: true, wish: w } : fail('心愿不存在')
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
    const raw = parseInt(data && data.n, 10)
    const n = Math.max(1, Math.min(999, isNaN(raw) ? 1 : raw))
    db.user.totalMerit = (db.user.totalMerit || 0) + n
    db.user.lastHitDate = today
    db.daily[today] = (db.daily[today] || 0) + n
    let wish = null
    const w = data && data.wishId ? db.wishes.find((x) => x._id === data.wishId) : null
    if (w && w.status === 'ongoing') {
      w.current = (w.current || 0) + n
      const log = w.hitLog.find((h: any) => h.date === today)
      if (log) log.count += n
      else w.hitLog.push({ date: today, count: n })
      if (w.current >= w.goal) {
        w.status = 'completed'
        w.completedDate = today
        w.hasSurprise = true
      }
      wish = w
    }
    save(db)
    return { ok: true, totalMerit: db.user.totalMerit, todayCount: db.daily[today], wish }
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
      })
      save(db)
      return { ok: true, wishId: id }
    }
    const w = db.wishes.find((x) => x._id === (data && data.wishId))
    if (!w) return fail('心愿不存在')
    if (action === 'update') {
      w.name = nameText.slice(0, 20)
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
      return { ok: true, wish: w }
    }
    if (action === 'remove') {
      db.wishes = db.wishes.filter((x) => x !== w)
      save(db)
      return { ok: true }
    }
    if (action === 'paperOrigin') return fail('本地模式没有壁纸')
    return fail('未知操作')
  }

  if (name === 'user') {
    const patch = (data && data.settings) || {}
    const premium = db.user.premium === true
    if (!premium && (PREMIUM_AMBIENCE[patch.ambience] || PREMIUM_THEME[patch.theme])) {
      return fail('一次开启后可用', 'premium')
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

  // 只读状态给个无害的默认值，页面能照常渲染
  if (name === 'wxpay' && data && data.action === 'verify') {
    return { ok: true, premium: db.user.premium === true, refunded: false }
  }
  if (name === 'checkChannelAuth') return { ok: true, isChannel: false }
  if (name === 'bindChannel') return { ok: true, bound: false, reason: 'mock' }
  if (name === 'channelAdmin' && data && data.action === 'check') {
    return { ok: true, isAdmin: false, needsBootstrap: false }
  }

  return fail('本地模式不支持')
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
