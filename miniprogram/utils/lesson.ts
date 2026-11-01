// 今日功课：当前选择写入 globalData，并记到本地，下次冷启动直接接着上次的心愿
import { fetchWishes } from './cloud'

export interface LessonPick {
  mode: 'wish' | 'random'
  wishId: string | null
  name: string
}

const STORE_KEY = 'muyu_last_lesson'
export const RANDOM_NAME = '随机专注'

export const RANDOM_LESSON: LessonPick = { mode: 'random', wishId: null, name: RANDOM_NAME }

export function loadLesson(): LessonPick | null {
  try {
    const v = wx.getStorageSync(STORE_KEY)
    if (v && (v.mode === 'wish' || v.mode === 'random')) {
      if (v.mode === 'wish' && !v.wishId) return RANDOM_LESSON
      return { mode: v.mode, wishId: v.wishId || null, name: v.name || '' }
    }
  } catch {
    // 读不到就当首次
  }
  return null
}

/** persist=false：只用于本次（首次打开还没选时先按随机专注摆好香案） */
export function applyLesson(p: LessonPick, persist = true) {
  const app = getApp<IAppOption>()
  const isWish = p.mode === 'wish' && !!p.wishId
  app.globalData.lessonChosen = true
  app.globalData.knockMode = isWish ? 'wish' : 'random'
  app.globalData.knockWishId = isWish ? p.wishId : null
  app.globalData.knockWishName = isWish ? p.name || '心愿' : RANDOM_NAME
  if (!persist) return
  try {
    wx.setStorageSync(STORE_KEY, {
      mode: app.globalData.knockMode,
      wishId: app.globalData.knockWishId,
      name: app.globalData.knockWishName,
    })
  } catch {
    // 存不下只影响下次启动
  }
}

/** 下一个进行中的心愿（跳过 excludeId）；没有就回到随机专注 */
export async function nextLesson(excludeId: string | null): Promise<LessonPick> {
  try {
    const res = await fetchWishes()
    const next = (res.wishes || []).find((w) => w.status === 'ongoing' && w._id !== excludeId)
    if (next) return { mode: 'wish', wishId: next._id, name: next.name || '心愿' }
  } catch {
    // 拉不到列表就退回随机
  }
  return RANDOM_LESSON
}

/** 删了一个心愿：它若是今日功课（本次或记在本机的上次），香案回到随机专注 */
export function forgetWish(wishId: string) {
  const app = getApp<IAppOption>()
  const last = loadLesson()
  if (app.globalData.knockWishId === wishId || (last && last.wishId === wishId)) applyLesson(RANDOM_LESSON)
}
