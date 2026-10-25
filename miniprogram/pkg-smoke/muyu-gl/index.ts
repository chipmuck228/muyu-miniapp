// 香案 3D 木鱼（WebGL1 程序化建模，见 ../muyuFish.ts）。strike 每 +1 敲一下。
import { winInfo } from '../../utils/util'
import { startMuyuFish, MuyuFishHandle, MuyuMaterial } from '../muyuFish'

const MAX_RETRY = 8

Component({
  properties: {
    /** 敲击序号：每变化一次播放一次下压回弹 */
    strike: {
      type: Number,
      value: 0,
    },
    material: {
      type: String,
      value: 'zitan',
    },
  },

  data: {
    canvasOn: true,
    fallback: false,
  },

  observers: {
    strike(n: number) {
      const fish: MuyuFishHandle | null = (this as any)._fish
      if (fish && n > 0) fish.strike()
    },
    material(m: string) {
      const fish: MuyuFishHandle | null = (this as any)._fish
      if (fish) fish.setMaterial(m as MuyuMaterial)
    },
  },

  lifetimes: {
    attached() {
      const self: any = this
      self._alive = true
      self._fish = null
      self._booting = false
      self._retry = 0
    },
    ready() {
      this.boot()
    },
    detached() {
      ;(this as any)._alive = false
      this.teardown()
    },
  },

  pageLifetimes: {
    show() {
      const self: any = this
      if (!self._alive || self._fish || self._booting) return
      this.setData({ canvasOn: true }, () => this.boot())
    },
    hide() {
      // 离开香案就停掉渲染循环，省电
      this.teardown()
    },
  },

  methods: {
    teardown() {
      const self: any = this
      self._booting = false
      if (self._fish) {
        self._fish.stop()
        self._fish = null
      }
      if (this.data.canvasOn) this.setData({ canvasOn: false })
    },

    boot() {
      const self: any = this
      if (!self._alive || self._fish || self._booting) return
      self._booting = true
      wx.nextTick(() => {
        this.createSelectorQuery()
          .select('#muyuCanvas')
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
                setTimeout(() => this.boot(), 80)
              } else {
                this.setData({ fallback: true })
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
              self._fish = startMuyuFish(item.node, item.width, item.height, dpr, this.data.material as MuyuMaterial)
              if (this.data.fallback) this.setData({ fallback: false })
            } catch (e) {
              console.error('[muyu] start failed', e)
              this.setData({ fallback: true, canvasOn: false })
            }
            self._booting = false
          })
      })
    },
  },
})
