import { winInfo } from '../../utils/util'
import { tintOf } from '../../utils/theme'
import { startIncensePlume, SMOKE_REV } from '../incensePlume'

function errText(e: any): string {
  const raw = (e && (e.message || e.errMsg || e.errMsg || e.stack)) || String(e || 'err')
  return String(raw).replace(/\s+/g, ' ').slice(0, 42)
}

Component({
  properties: {
    theme: {
      type: String,
      value: 'dawn',
    },
    /** 烟头相对默认位置的下移比例（负数上移）：一炷香燃烧时跟着香头走 */
    sink: {
      type: Number,
      value: 0,
    },
    /** 整体透明度 0..1：面板盖上时为 0，心愿越近圆满越淡 */
    fade: {
      type: Number,
      value: 1,
    },
  },

  data: {
    smokeFallback: false,
    smokeRev: '',
    canvasOn: true,
  },

  observers: {
    theme(id: string) {
      if (this._smoke && typeof this._smoke.setTint === 'function') {
        this._smoke.setTint(tintOf(id))
      }
    },
    sink(r: number) {
      if (this._smoke && typeof this._smoke.setSink === 'function') this._smoke.setSink(r)
    },
    fade(a: number) {
      if (this._smoke && typeof this._smoke.setFade === 'function') this._smoke.setFade(a)
    },
  },

  lifetimes: {
    attached() {
      this._alive = true
      this._smoke = null
      this._booting = false
      this._retry = 0
    },
    ready() {
      this.bootSmoke()
    },
    detached() {
      this._alive = false
      this.teardown()
    },
  },

  pageLifetimes: {
    show() {
      if (!this._alive) return
      if (this._smoke || this._booting) return
      this.setData({ canvasOn: true }, () => this.bootSmoke())
    },
    hide() {
      this.teardown()
    },
  },

  methods: {
    teardown() {
      this._booting = false
      if (this._smoke) {
        this._smoke.stop()
        this._smoke = null
      }
      if (this.data.canvasOn) this.setData({ canvasOn: false })
    },

    bootSmoke() {
      if (!this._alive || this._smoke || this._booting) return
      this._booting = true
      if (!this.data.canvasOn) {
        this.setData({ canvasOn: true }, () => this.queryAndStart())
        return
      }
      this.queryAndStart()
    },

    queryAndStart() {
      wx.nextTick(() => {
        if (!this._alive) {
          this._booting = false
          return
        }
        const q: any = this.createSelectorQuery().in(this)
        q.select('#smokeCanvas')
          .fields({ node: true, size: true })
          .exec((res: any) => {
            const item = res && res[0]
            if (!this._alive) {
              this._booting = false
              return
            }
            if (!item || !item.node || !item.width || !item.height) {
              this._booting = false
              if (this._retry < 8) {
                this._retry += 1
                setTimeout(() => {
                  if (this._alive) this.bootSmoke()
                }, 80)
              } else {
                this.setData({ smokeFallback: true, smokeRev: 'fallback-canvas' })
                this.triggerEvent('risen')
              }
              return
            }
            this._retry = 0
            let dpr = 2
            try {
              dpr = Math.max(1, Math.min(Number(winInfo().pixelRatio) || 2, 2))
            } catch {
              dpr = 2
            }
            try {
              this._smoke = startIncensePlume(
                item.node,
                item.width,
                item.height,
                dpr,
                () => {
                  if (this._alive) this.triggerEvent('risen')
                },
                tintOf(this.data.theme)
              )
              if (this.data.sink) this._smoke.setSink(this.data.sink)
              this._smoke.setFade(this.data.fade, true)
              this._booting = false
              this.setData({
                smokeFallback: false,
                smokeRev: SMOKE_REV + ' ' + Math.round(item.width) + 'x' + Math.round(item.height),
              })
            } catch (e) {
              this._booting = false
              console.error('[smoke] start failed', e)
              this.setData({ smokeFallback: true, smokeRev: 'e:' + errText(e) })
              this.triggerEvent('risen')
            }
          })
      })
    },
  },
})
