import { winInfo } from '../../utils/util'
import { tintOf } from '../../utils/theme'
import { startIncensePlume, SMOKE_REV } from '../incensePlume'

const MAX_RETRY = 8

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
    canvasOn: true,
  },

  observers: {
    theme(id: string) {
      const smoke = (this as any)._smoke
      if (smoke && typeof smoke.setTint === 'function') smoke.setTint(tintOf(id))
    },
    sink(r: number) {
      const smoke = (this as any)._smoke
      if (smoke && typeof smoke.setSink === 'function') smoke.setSink(r)
    },
    fade(a: number) {
      const smoke = (this as any)._smoke
      if (smoke && typeof smoke.setFade === 'function') smoke.setFade(a)
    },
  },

  lifetimes: {
    attached() {
      const self: any = this
      self._alive = true
      self._smoke = null
      self._booting = false
      self._retry = 0
    },
    ready() {
      this.bootSmoke()
    },
    detached() {
      ;(this as any)._alive = false
      this.teardown()
    },
  },

  pageLifetimes: {
    show() {
      const self: any = this
      if (!self._alive || self._smoke || self._booting) return
      this.setData({ canvasOn: true }, () => this.bootSmoke())
    },
    hide() {
      this.teardown()
    },
  },

  methods: {
    teardown() {
      const self: any = this
      self._booting = false
      if (self._smoke) {
        self._smoke.stop()
        self._smoke = null
      }
      if (this.data.canvasOn) this.setData({ canvasOn: false })
    },

    bootSmoke() {
      const self: any = this
      if (!self._alive || self._smoke || self._booting) return
      self._booting = true
      if (!this.data.canvasOn) {
        this.setData({ canvasOn: true }, () => this.queryAndStart())
        return
      }
      this.queryAndStart()
    },

    /** WebGL 起不来：退回 CSS 版青烟，也照样通知页面「烟已升起」 */
    fallBack(why: string, e?: any) {
      const self: any = this
      self._booting = false
      if (e) console.error('[smoke] ' + why, e)
      else console.warn('[smoke] ' + why)
      this.setData({ smokeFallback: true })
      this.triggerEvent('risen')
    },

    queryAndStart() {
      const self: any = this
      wx.nextTick(() => {
        if (!self._alive) {
          self._booting = false
          return
        }
        const q: any = this.createSelectorQuery().in(this)
        q.select('#smokeCanvas')
          .fields({ node: true, size: true })
          .exec((res: any) => {
            const item = res && res[0]
            if (!self._alive) {
              self._booting = false
              return
            }
            if (!item || !item.node || !item.width || !item.height) {
              self._booting = false
              if (self._retry < MAX_RETRY) {
                self._retry += 1
                setTimeout(() => {
                  if (self._alive) this.bootSmoke()
                }, 80)
              } else {
                this.fallBack('canvas not found')
              }
              return
            }
            self._retry = 0
            let dpr = 2
            try {
              dpr = Math.max(1, Math.min(Number(winInfo().pixelRatio) || 2, 2))
            } catch {
              dpr = 2
            }
            try {
              self._smoke = startIncensePlume(
                item.node,
                item.width,
                item.height,
                dpr,
                () => {
                  if (self._alive) this.triggerEvent('risen')
                },
                tintOf(this.data.theme)
              )
              if (this.data.sink) self._smoke.setSink(this.data.sink)
              self._smoke.setFade(this.data.fade, true)
              self._booting = false
              // 版本号只进日志：以前画在香案左上角，用户也看得见
              console.log('[smoke]', SMOKE_REV, Math.round(item.width) + 'x' + Math.round(item.height))
              if (this.data.smokeFallback) this.setData({ smokeFallback: false })
            } catch (e) {
              this.fallBack('start failed', e)
            }
          })
      })
    },
  },
})
