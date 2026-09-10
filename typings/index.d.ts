/// <reference path="./types/index.d.ts" />

interface IAppOption {
  globalData: {
    /** 状态栏高度（px），自定义导航栏使用 */
    statusBarHeight: number
    /** 当前登录用户（缓存） */
    user?: any
    /** 从其他 Tab 点回木鱼：首页播放入场动画 */
    homeEnterAnim?: boolean
    /** 离开木鱼去其他 Tab：预先盖上遮罩，避免切回时闪一帧旧画面 */
    homeWillReenter?: boolean
    /** 入堂页离场后，首页跳过冷启动莲花遮罩 */
    fromGate?: boolean
    /** 当次会话已在功课页选定心愿或随机功德 */
    lessonChosen?: boolean
    knockMode?: 'wish' | 'random'
    knockWishId?: string | null
  }
}
