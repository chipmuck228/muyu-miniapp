// 香案主题。晨免费；夜 / 墨 / 霞需 users.premium，客户端改不了这个标记。

export type ThemeId = 'dawn' | 'night' | 'ink' | 'dusk'

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface SmokeTint {
  ember: [number, number, number]
  plume: [number, number, number]
}

export interface ThemeDef {
  id: ThemeId
  name: string
  /** 一句话说清这套主题换了什么 */
  desc: string
  premium: boolean
  /** 静心页的色块预览，取香案背景的天色和光晕色 */
  swatch: [string, string]
  from: Rgb
  to: Rgb
  tint: SmokeTint
}

export const THEMES: ThemeDef[] = [
  {
    id: 'dawn',
    name: '晨',
    desc: '暖金晨光，烟色灰白',
    premium: false,
    swatch: ['#1c140c', '#c88a4a'],
    from: { r: 255, g: 246, b: 230 },
    to: { r: 232, g: 201, b: 138 },
    tint: { ember: [1, 0.36, 0.16], plume: [0.8, 0.82, 0.84] },
  },
  {
    id: 'night',
    name: '夜',
    desc: '月下银蓝，字色清冷',
    premium: true,
    swatch: ['#0c1626', '#6f93c4'],
    from: { r: 206, g: 224, b: 246 },
    to: { r: 158, g: 186, b: 210 },
    tint: { ember: [0.42, 0.58, 0.82], plume: [0.68, 0.76, 0.86] },
  },
  {
    id: 'ink',
    name: '墨',
    desc: '黑白水墨，只留骨白',
    premium: true,
    swatch: ['#161616', '#a8a49a'],
    from: { r: 236, g: 233, b: 226 },
    to: { r: 196, g: 192, b: 184 },
    tint: { ember: [0.62, 0.58, 0.52], plume: [0.75, 0.74, 0.72] },
  },
  {
    id: 'dusk',
    name: '霞',
    desc: '落日霞红，烟色也暖',
    premium: true,
    swatch: ['#2a1210', '#e0784a'],
    from: { r: 255, g: 222, b: 198 },
    to: { r: 232, g: 154, b: 112 },
    tint: { ember: [1, 0.45, 0.2], plume: [0.9, 0.7, 0.58] },
  },
]

export function parseTheme(v: any): ThemeId {
  if (v === 'night' || v === 'ink' || v === 'dusk' || v === 'dawn') return v
  return 'dawn'
}

export function isPremiumTheme(id: string): boolean {
  for (let i = 0; i < THEMES.length; i++) {
    if (THEMES[i].id === id) return THEMES[i].premium
  }
  return false
}

export function themeOf(id?: string | null): ThemeDef {
  const want = parseTheme(id)
  for (let i = 0; i < THEMES.length; i++) {
    if (THEMES[i].id === want) return THEMES[i]
  }
  return THEMES[0]
}

export function themeEnds(id?: string | null): { from: Rgb; to: Rgb } {
  const t = themeOf(id)
  return { from: t.from, to: t.to }
}

export function tintOf(id?: string | null): SmokeTint {
  return themeOf(id).tint
}
