// 敲击队列：高频敲击在客户端合并批量提交，避免请求风暴，且计数不丢失。亲手 / 自动分开记数
import { hitKnock, HitResp } from './cloud'

export type TapSource = 'hand' | 'auto'

export interface KnockResult {
  totalMerit: number
  todayCount: number
  /** 本轮敲击是否让心愿由进行中变为已圆满 */
  completed: boolean
  /** 对应心愿在云端是否仍为进行中（可能已被还愿/删除） */
  active: boolean
}

/** 上传失败后隔多久重传；用完了才提示用户，敲下的数仍留着，下一次敲击会一起带上 */
const RETRY_MS = [1500, 4000, 10000]

export class KnockQueue {
  private pending: { hand: number; auto: number }
  private running: boolean
  private alive: boolean
  private retries: number
  private retryTimer: number

  constructor(
    private readonly wishIdProvider: () => string | null,
    private readonly onResult: (r: KnockResult) => void,
    private readonly onError: () => void = () => undefined
  ) {
    this.pending = { hand: 0, auto: 0 }
    this.running = false
    this.alive = true
    this.retries = 0
    this.retryTimer = 0
  }

  tap(source: TapSource, n = 1) {
    if (!this.alive) return
    this.pending[source] += n
    this.flush()
  }

  private hasPending(): boolean {
    return this.pending.hand + this.pending.auto > 0
  }

  private async flush() {
    // 正在等重传时新敲的先攒着，到点一起传
    if (this.running || this.retryTimer) return
    this.running = true
    while (this.hasPending() && this.alive) {
      const by = this.pending
      this.pending = { hand: 0, auto: 0 }
      const wishId = this.wishIdProvider()
      try {
        const res: HitResp = await hitKnock(wishId, by)
        if (!this.alive) return
        this.retries = 0
        this.onResult({
          totalMerit: res.totalMerit,
          todayCount: res.todayCount,
          completed: !!(res.wish && res.wish.status === 'completed'),
          active: !!(res.wish && res.wish.status === 'ongoing'),
        })
      } catch {
        if (!this.alive) return
        // 放回去，别丢：网络抖一下就重传
        this.pending.hand += by.hand
        this.pending.auto += by.auto
        if (this.retries < RETRY_MS.length) {
          const wait = RETRY_MS[this.retries]
          this.retries += 1
          this.retryTimer = setTimeout(() => {
            this.retryTimer = 0
            this.flush()
          }, wait) as unknown as number
        } else {
          this.retries = 0
          this.onError()
        }
        break
      }
    }
    this.running = false
  }

  destroy() {
    this.alive = false
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = 0
    }
    this.pending = { hand: 0, auto: 0 }
  }
}
