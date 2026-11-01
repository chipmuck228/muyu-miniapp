// 敲击队列：高频敲击在客户端合并批量提交，避免请求风暴，且计数不丢失。亲手 / 自动分开记数
import { hitKnock, HitResp } from './cloud'
import { todayStr } from './util'

export type TapSource = 'hand' | 'auto'

export interface KnockResult {
  totalMerit: number
  todayCount: number
  /** 本轮敲击是否让心愿由进行中变为已圆满 */
  completed: boolean
  /** 对应心愿在云端是否仍为进行中（可能已被还愿/删除） */
  active: boolean
}

/** 一批敲击。失败重传时原样再发：同一个号、同一天、同一个心愿，云端按号去重 */
interface Batch {
  id: string
  date: string
  wishId: string | null
  hand: number
  auto: number
}

/** 上传失败后隔多久重传；用完了才提示用户，这批仍留着，下一次敲击会先把它补上 */
const RETRY_MS = [1500, 4000, 10000]
/** 云端每批每种来源最多收 999，多的留到下一批 */
const MAX_PER_SOURCE = 999

function batchId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export class KnockQueue {
  private pending: { hand: number; auto: number }
  /** 发出去还没确认的那一批 */
  private inflight: Batch | null
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
    this.inflight = null
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

  /** 先补没确认的那批，再把攒着的切一批出来 */
  private nextBatch(): Batch | null {
    if (this.inflight) return this.inflight
    if (this.pending.hand + this.pending.auto <= 0) return null
    const hand = Math.min(MAX_PER_SOURCE, this.pending.hand)
    const auto = Math.min(MAX_PER_SOURCE, this.pending.auto)
    this.pending.hand -= hand
    this.pending.auto -= auto
    this.inflight = { id: batchId(), date: todayStr(), wishId: this.wishIdProvider(), hand, auto }
    return this.inflight
  }

  private async flush() {
    // 正在等重传时新敲的先攒着，到点一起传
    if (this.running || this.retryTimer) return
    this.running = true
    let batch = this.nextBatch()
    while (batch && this.alive) {
      try {
        const res: HitResp = await hitKnock(batch.wishId, { hand: batch.hand, auto: batch.auto }, batch.id, batch.date)
        if (!this.alive) return
        this.inflight = null
        this.retries = 0
        this.onResult({
          totalMerit: res.totalMerit,
          todayCount: res.todayCount,
          completed: !!(res.wish && res.wish.status === 'completed'),
          active: !!(res.wish && res.wish.status === 'ongoing'),
        })
      } catch {
        if (!this.alive) return
        // 别丢：这批原样留着重传，云端认得这个号，真记过了也不会再记一遍
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
      batch = this.nextBatch()
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
    this.inflight = null
  }
}
