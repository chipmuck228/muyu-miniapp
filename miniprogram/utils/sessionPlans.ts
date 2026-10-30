// 成品定课：声音、主题、木鱼音色、自动敲节奏、时长和收尾都配好，点一下就开始。
// 雨窗片刻免费；另两套属于静心包，没开的人每套可以完整试一次。
import { AmbienceId } from './audioCatalog'
import { ThemeId } from './theme'
import { KnockTimbre } from './knock'

export type PlanId = 'rain' | 'pine' | 'night'

export interface SessionPlan {
  id: PlanId
  name: string
  /** 面板上的一句说明 */
  scene: string
  premium: boolean
  ambience: AmbienceId
  theme: ThemeId
  timbre: KnockTimbre
  /** 自动敲的间隔（ms）：从 gapFrom 随进度慢慢变到 gapTo */
  gapFrom: number
  gapTo: number
  minutes: number
  /** 结束时氛围淡出的时长（ms），淡完再响钟钵 */
  fadeMs: number
  /** 小结卡片上的收尾语 */
  closing: string
}

export const SESSION_PLANS: SessionPlan[] = [
  {
    id: 'rain',
    name: '雨窗片刻',
    scene: '工作间隙，停一下',
    premium: false,
    ambience: 'rain',
    theme: 'dawn',
    timbre: 'default',
    gapFrom: 800,
    gapTo: 800,
    minutes: 3,
    fadeMs: 2000,
    closing: '雨还在下，你可以回去了',
  },
  {
    id: 'pine',
    name: '松间慢叩',
    scene: '想慢慢敲一会儿',
    premium: true,
    ambience: 'pine',
    theme: 'ink',
    timbre: 'low',
    gapFrom: 1200,
    gapTo: 1200,
    minutes: 5,
    fadeMs: 3000,
    closing: '风过松林，心也慢了',
  },
  {
    id: 'night',
    name: '夜里收心',
    scene: '睡前，把今天放下',
    premium: true,
    ambience: 'fire',
    theme: 'night',
    timbre: 'soft',
    gapFrom: 1000,
    gapTo: 3000,
    minutes: 10,
    fadeMs: 4000,
    closing: '今天到这里，好好睡',
  },
]

export function planOf(id: string): SessionPlan | null {
  return SESSION_PLANS.find((p) => p.id === id) || null
}

// 试过的付费定课记在本机：完整走完或提前收起都算试过
const TRIED_KEY = 'muyu_plan_tried'

export function triedPlans(): Record<string, 1> {
  try {
    const v = wx.getStorageSync(TRIED_KEY)
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export function markPlanTried(id: PlanId) {
  try {
    const v = triedPlans()
    v[id] = 1
    wx.setStorageSync(TRIED_KEY, v)
  } catch {
    // 存不下就当没试过，下次还能再试
  }
}
