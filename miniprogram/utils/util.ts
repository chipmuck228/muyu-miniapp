// 日期与格式化工具

/** 获取窗口/系统信息（兼容旧基础库，无类型声明时以 any 返回） */
export function winInfo(): any {
  const anyWx: any = wx
  return anyWx.getWindowInfo ? anyWx.getWindowInfo() : wx.getSystemInfoSync()
}

export const pad2 = (n: number): string => (n < 10 ? '0' + n : '' + n)

/** Date -> YYYY-MM-DD（本地时区） */
export function formatDate(d: Date): string {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

/** 今天的 YYYY-MM-DD */
export function todayStr(): string {
  return formatDate(new Date())
}

/** 相对某天偏移 delta 天的日期字符串 */
export function offsetDate(dateStr: string, delta: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + delta)
  return formatDate(d)
}

/** 最近 n 天（含今天，升序） */
export function lastNDays(n: number, end = todayStr()): string[] {
  const arr: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    arr.push(offsetDate(end, -i))
  }
  return arr
}

/** 整数千分位 */
export function fmtInt(n: number): string {
  const s = Math.max(0, Math.floor(n)).toString()
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 心愿专注的来源构成：「其中 亲手 3,240 · 燃香 6 炷 · 自动 1,200」。早先没记来源的心愿返回空串 */
export function sourceLine(w: { bySource?: { hand?: number; auto?: number; incense?: number }; incenseCount?: number }): string {
  const by = w.bySource
  if (!by) return ''
  const parts: string[] = []
  if (by.hand && by.hand > 0) parts.push('亲手 ' + fmtInt(by.hand))
  if (w.incenseCount && w.incenseCount > 0) parts.push('燃香 ' + w.incenseCount + ' 炷')
  if (by.auto && by.auto > 0) parts.push('自动 ' + fmtInt(by.auto))
  return parts.length ? '其中 ' + parts.join(' · ') : ''
}

/** '2026-09-07' -> '9月7日' */
export function fmtMD(dateStr: string): string {
  const m = parseInt(dateStr.slice(5, 7), 10)
  const d = parseInt(dateStr.slice(8, 10), 10)
  return m + '月' + d + '日'
}

/** '2026-09-07' -> '2026年9月7日' */
export function fmtFullCN(dateStr: string): string {
  const y = parseInt(dateStr.slice(0, 4), 10)
  const m = parseInt(dateStr.slice(5, 7), 10)
  const d = parseInt(dateStr.slice(8, 10), 10)
  return y + '年' + m + '月' + d + '日'
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']

/** '2026-09-07' -> '周一' */
export function weekdayCN(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return '周' + WEEKDAY_CN[d.getDay()]
}

/** 周一为 0 的星期索引 */
export function weekdayMon0(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00')
  return (d.getDay() + 6) % 7
}

/** 距离今天还有几天（可为负） */
export function diffToday(dateStr: string): number {
  const a = new Date(todayStr() + 'T00:00:00').getTime()
  const b = new Date(dateStr + 'T00:00:00').getTime()
  return Math.round((b - a) / 86400000)
}

/** 期限的说法：还剩 N 天 / 今日截止 / 已过期限 N 天。没设期限返回空串 */
export function dueText(deadline?: string | null): { text: string; late: boolean } {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return { text: '', late: false }
  const n = diffToday(deadline)
  if (n > 0) return { text: '还剩 ' + n + ' 天', late: false }
  if (n === 0) return { text: '今日截止', late: false }
  return { text: '已过期限 ' + -n + ' 天', late: true }
}

export function safeBottomPx(): number {
  try {
    const win: any = winInfo()
    if (win.safeArea && win.screenHeight) {
      return Math.max(0, win.screenHeight - win.safeArea.bottom)
    }
  } catch {
    // ignore
  }
  return 0
}

export function concealTabBar(page: any) {
  try {
    wx.hideTabBar({ animation: false })
  } catch {
    // ignore
  }
  if (page && page.getTabBar && page.getTabBar()) {
    page.getTabBar().setData({ hidden: true })
  }
}

export function revealTabBar(page: any, selected: number) {
  try {
    wx.showTabBar({ animation: false })
  } catch {
    // ignore
  }
  if (page && page.getTabBar && page.getTabBar()) {
    page.getTabBar().setData({ hidden: false, selected })
  }
}
