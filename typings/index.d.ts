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
    /** 当次会话已在功课页选定心愿或随机专注 */
    lessonChosen?: boolean
    knockMode?: 'wish' | 'random'
    knockWishId?: string | null
    /** 今日功课标题：心愿名，或「随机专注」 */
    knockWishName?: string | null
    /** 首次打开：进香案后自动弹出「今日功课」面板 */
    openLessonSheet?: boolean
    /** 圆满弹窗点「查看证书」：证书页优先展示这张 */
    certFocusId?: string | null
    /** 在香案面板里点「立新愿」并立好：回到香案时收起面板，接着为新心愿敲 */
    newWishPicked?: boolean
    /** 扫码进入时的 scene，供首页首次触点归因 */
    pendingChannelScene?: string | null
  }
}
