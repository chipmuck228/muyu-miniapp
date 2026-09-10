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
