// 主页星空：Canvas 2D 复刻 p5 流场星尘（小程序没有 DOM，p5 无法直接运行）
// 效果对应参考实现的三个要素：柏林噪声流场角度、低透明度全屏叠色拖尾、边界重置
import { winInfo } from '../../utils/util'

const MOVE_SPEED = 0.4
const MOVE_SCALE = 800
/** 与参考实现一致：每帧盖一层 20/255 的底色做拖尾 */
const TRAIL_ALPHA = 0.08
const BASE_RGB = '0,10,15'

/** 翡翠调色盘 */
const PALETTE = [
  '#77c39c',
  '#2f5e36',
  '#55aba5',
  '#2d7063',
  '#3f6829',
  '#44a872',
  '#215964',
  '#cdedae',
]

// —— 2D 柏林噪声（无依赖，够用）——
const PERM = new Uint8Array(512)
;(function seedPerm() {
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  let s = 1337
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647
    const j = s % (i + 1)
    const t = p[i]
    p[i] = p[j]
    p[j] = t
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]
})()

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function grad(hash: number, x: number, y: number): number {
  switch (hash & 7) {
    case 0:
      return x + y
    case 1:
      return -x + y
    case 2:
      return x - y
    case 3:
      return -x - y
    case 4:
      return x
    case 5:
      return -x
    case 6:
      return y
    default:
      return -y
  }
}

/** 返回 0..1，与 p5.noise 同量纲 */
function noise2(x: number, y: number): number {
  const xi = Math.floor(x) & 255
  const yi = Math.floor(y) & 255
  const xf = x - Math.floor(x)
  const yf = y - Math.floor(y)
  const u = fade(xf)
  const v = fade(yf)
  const aa = PERM[PERM[xi] + yi]
  const ab = PERM[PERM[xi] + yi + 1]
  const ba = PERM[PERM[xi + 1] + yi]
  const bb = PERM[PERM[xi + 1] + yi + 1]
  const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u)
  const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u)
  return (lerp(x1, x2, v) + 1) * 0.5
}

interface Particle {
  x: number
  y: number
  c: number
}

/** 按设备性能定粒子数：参考实现是 2000，中低端机按比例降 */
function particleCount(): number {
  let level = -1
  try {
    const info: any = wx.getSystemInfoSync()
    level = Number(info.benchmarkLevel)
  } catch (e) {
    level = -1
  }
  if (level >= 30) return 2000
  if (level >= 20) return 1500
  if (level > 0) return 900
  return 1200
}

Component({
  properties: {
    /** 仅用于将来按主题换色，当前调色盘固定 */
    theme: {
      type: String,
      value: 'dawn',
    },
    /** 页面可见且已就绪时才跑动画 */
    active: {
      type: Boolean,
      value: true,
    },
  },

  data: {},

  observers: {
    active(v: boolean) {
      const s: any = this
      if (!s._inited) return
      if (v) s.start()
      else s.stop()
    },
  },

  lifetimes: {
    ready() {
      ;(this as any).boot()
    },
    detached() {
      ;(this as any).teardown()
    },
  },

  pageLifetimes: {
    show() {
      const s: any = this
      if (s._inited && s.data.active) s.start()
    },
    hide() {
      ;(this as any).stop()
    },
  },

  methods: {
    boot() {
      const s: any = this
      if (s._inited || s._booting) return
      s._booting = true
      s._retry = s._retry || 0
      s.createSelectorQuery()
        .select('#sky')
        .fields({ node: true, size: true })
        .exec((res: any[]) => {
          s._booting = false
          const info = res && res[0]
          const canvas = info && info.node
          // 首屏有时拿不到尺寸（布局未完成），稍后重试几次
          if ((!canvas || !info.width || !info.height) && s._retry < 5) {
            s._retry++
            setTimeout(() => s.boot(), 120)
            return
          }
          if (!canvas || !info.width || !info.height) return
          const ctx = canvas.getContext('2d')
          if (!ctx) return

          const dpr = Number(winInfo().pixelRatio) || 2
          s._canvas = canvas
          s._ctx = ctx
          s._w = info.width
          s._h = info.height
          s._raf = 0
          s._running = false
          s._inited = true

          canvas.width = Math.floor(info.width * dpr)
          canvas.height = Math.floor(info.height * dpr)
          ctx.scale(dpr, dpr)

          s._sprites = this.makeSprites()
          s._pts = this.makeParticles(particleCount())

          // 第一帧直接铺底色，避免从白屏渐变过来
          ctx.fillStyle = 'rgb(' + BASE_RGB + ')'
          ctx.fillRect(0, 0, s._w, s._h)

          // 离屏 canvas 作为 drawImage 源在部分基础库上不可用，
          // 画到屏幕外自检一次，失败就退回 fillRect
          if (s._sprites) {
            try {
              ctx.drawImage(s._sprites[0], -20, -20, 8, 8)
            } catch (e) {
              s._sprites = null
            }
          }

          if (s.data.active) s.start()
        })
    },

    /** 预渲染 8 个颜色的小圆，绘制时用 drawImage 比逐个 arc 快很多 */
    makeSprites(): any[] | null {
      const anyWx: any = wx
      if (typeof anyWx.createOffscreenCanvas !== 'function') return null
      const out: any[] = []
      for (let i = 0; i < PALETTE.length; i++) {
        try {
          const oc = anyWx.createOffscreenCanvas({ type: '2d', width: 8, height: 8 })
          const octx = oc.getContext('2d')
          octx.fillStyle = PALETTE[i]
          octx.beginPath()
          octx.arc(4, 4, 1.6, 0, Math.PI * 2)
          octx.fill()
          out.push(oc)
        } catch (e) {
          return null
        }
      }
      return out
    },

    makeParticles(n: number): Particle[] {
      const s: any = this
      const w = s._w || 300
      const h = s._h || 300
      const pts: Particle[] = []
      for (let i = 0; i < n; i++) {
        pts.push({
          x: Math.random() * w,
          y: Math.random() * h,
          c: Math.floor(Math.random() * PALETTE.length),
        })
      }
      return pts
    },

    start() {
      const s: any = this
      if (!s._inited || s._running) return
      s._running = true
      s._raf = s._canvas.requestAnimationFrame((t: number) => s.tick(t))
    },

    stop() {
      const s: any = this
      s._running = false
      if (s._raf && s._canvas) {
        s._canvas.cancelAnimationFrame(s._raf)
        s._raf = 0
      }
    },

    tick() {
      const s: any = this
      if (!s._running) return
      const ctx = s._ctx
      const w = s._w
      const h = s._h
      const pts: Particle[] = s._pts
      const sprites: any[] | null = s._sprites

      // 半透明底色叠一层：旧帧自然衰减成拖尾
      ctx.fillStyle = 'rgba(' + BASE_RGB + ',' + TRAIL_ALPHA + ')'
      ctx.fillRect(0, 0, w, h)

      const spin = Math.PI * 2 * MOVE_SCALE
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]
        // 高频相位缠绕：noise 值放大到 2π×800，角度抖动足够碎
        const angle = noise2(p.x / MOVE_SCALE, p.y / MOVE_SCALE) * spin
        p.x += Math.cos(angle) * MOVE_SPEED
        p.y += Math.sin(angle) * MOVE_SPEED

        if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
          p.x = Math.random() * w
          p.y = Math.random() * h
        }

        if (sprites) {
          ctx.drawImage(sprites[p.c], p.x - 4, p.y - 4, 8, 8)
        } else {
          ctx.fillStyle = PALETTE[p.c]
          ctx.fillRect(p.x, p.y, 2.4, 2.4)
        }
      }

      s._raf = s._canvas.requestAnimationFrame(() => s.tick())
    },

    teardown() {
      const s: any = this
      s.stop()
      s._inited = false
      s._pts = []
      s._sprites = null
      s._ctx = null
      s._canvas = null
    },
  },
})
