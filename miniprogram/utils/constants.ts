// 常量与等级表

export interface LevelDef {
  level: number
  need: number
  title: string
}

export const LEVELS: LevelDef[] = [
  { level: 1, need: 0, title: '初入佛门' },
  { level: 2, need: 100, title: '小有功德' },
  { level: 3, need: 500, title: '善根渐长' },
  { level: 4, need: 1000, title: '福德绵延' },
  { level: 5, need: 3000, title: '功德无量' },
  { level: 6, need: 8000, title: '菩萨心肠' },
  { level: 7, need: 20000, title: '觉者之路' },
  { level: 8, need: 50000, title: '菩提萨埵' },
  { level: 9, need: 100000, title: '佛光普照' },
]

export interface LevelInfo {
  level: number
  title: string
  curNeed: number
  nextNeed: number
  /** 当前等级内进度 0-1 */
  progress: number
  isMax: boolean
}

export function levelOf(totalMerit: number): LevelInfo {
  let idx = 0
  for (let i = 0; i < LEVELS.length; i++) {
    if (totalMerit >= LEVELS[i].need) idx = i
  }
  const cur = LEVELS[idx]
  const next = LEVELS[idx + 1]
  if (!next) {
    return { level: cur.level, title: cur.title, curNeed: cur.need, nextNeed: cur.need, progress: 1, isMax: true }
  }
  const progress = Math.max(0, Math.min(1, (totalMerit - cur.need) / (next.need - cur.need)))
  return { level: cur.level, title: cur.title, curNeed: cur.need, nextNeed: next.need, progress, isMax: false }
}

/** 心愿目标预设 */
export const PRESET_GOALS: number[] = [100, 500, 1000, 5000, 10000]

/** 敲击飘字随机禅语 */
export const CHANTS: string[] = ['善哉', '随喜', '阿弥陀佛', '心诚则灵', '功德无量', '禅心自在']

export const STATUS_TEXT: Record<string, string> = {
  ongoing: '进行中',
  completed: '已圆满',
  fulfilled: '已还愿',
}

/** 心愿状态：进度条展示百分比封顶 */
export function percentOf(current: number, goal: number): number {
  if (!goal || goal <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((current / goal) * 100)))
}

/** 心情彩色 */
export const STATUS_CLS: Record<string, string> = {
  ongoing: 'ongoing',
  completed: 'completed',
  fulfilled: 'fulfilled',
}
