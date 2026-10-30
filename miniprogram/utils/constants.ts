// 常量与等级表

export interface LevelDef {
  level: number
  need: number
  title: string
}

export const LEVELS: LevelDef[] = [
  { level: 1, need: 0, title: '初学静心' },
  { level: 2, need: 100, title: '渐入专注' },
  { level: 3, need: 500, title: '日有所进' },
  { level: 4, need: 1000, title: '心愿渐明' },
  { level: 5, need: 3000, title: '专注日深' },
  { level: 6, need: 8000, title: '自我提升' },
  { level: 7, need: 20000, title: '心愿管理' },
  { level: 8, need: 50000, title: '静心有恒' },
  { level: 9, need: 100000, title: '心愿得所' },
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

/** 定课：一炷香定时（分钟）、一串念珠定数。手敲 / 自动都照常计入专注 */
export const SESSION_MINUTES: number[] = [3, 5, 10]
export const SESSION_BEADS = 108

/** 敲击飘字 */
export const CHANTS: string[] = ['静心', '专注', '一步', '加油', '心愿', '继续']

export const STATUS_TEXT: Record<string, string> = {
  ongoing: '进行中',
  completed: '已成',
  fulfilled: '已了结',
}

/** 图库档位（仅规则；壁纸文件在云端） */
export const PAPER_TIERS: { id: string; min: number; max: number }[] = [
  { id: 'su', min: 1, max: 99 },
  { id: 'ya', min: 100, max: 499 },
  { id: 'jing', min: 500, max: 999 },
  { id: 'zhen', min: 1000, max: 4999 },
  { id: 'ji', min: 5000, max: 1e9 },
]

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
