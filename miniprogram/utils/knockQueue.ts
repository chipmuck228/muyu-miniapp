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

export class KnockQueue {
  private pending: { hand: number; auto: number }
  private running: boolean
  private alive: boolean

  constructor(
    private readonly wishIdProvider: () => string | null,
    private readonly onResult: (r: KnockResult) => void,
    private readonly onError: () => void = () => undefined
  ) {
    this.pending = { hand: 0, auto: 0 }
    this.running = false
    this.alive = true
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
    if (this.running) return
    this.running = true
    while (this.hasPending() && this.alive) {
      const by = this.pending
      this.pending = { hand: 0, auto: 0 }
      const wishId = this.wishIdProvider()
      try {
        const res: HitResp = await hitKnock(wishId, by)
        if (!this.alive) return
        this.onResult({
          totalMerit: res.totalMerit,
          todayCount: res.todayCount,
          completed: !!(res.wish && res.wish.status === 'completed'),
          active: !!(res.wish && res.wish.status === 'ongoing'),
        })
      } catch {
        if (this.alive) this.onError()
        // 失败即终止，避免死循环
        break
      }
    }
    this.running = false
  }

  destroy() {
    this.alive = false
    this.pending = { hand: 0, auto: 0 }
  }
}
