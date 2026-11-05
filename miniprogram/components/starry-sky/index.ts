// 主页星夜背景：原生 Canvas 2D 流场星尘（无 p5、无第三方依赖）
// 移植自 Starry Night 参考实现：柏林噪声相位调制 + 低透明度拖尾 + 边界循环
import { winInfo } from '../../utils/util'

const MOVE_SPEED = 0.45
const MOVE_SCALE = 750
/** 星点半径，与参考实现一致（直径 2.8px） */
const DOT_RADIUS = 1.4

interface SkyPalette {
  /** 底色，rgb 三元组 */
  base: string
  /** 每帧覆盖的透明度，越小拖尾越长 */
  trail: number
  /** 星尘颜色（rgba，整体压淡以免糊住前景） */
  colors: string[]
}

/**
 * 参考实现自带三套调色盘；另外三套按香案主题配的，
 * 默认跟随主题取色，不再出现"暖金界面飘一片翡翠绿"。
 */
const PALETTES: { [k: string]: SkyPalette } = {
  // 翡翠极光（参考实现原版）
  emerald: {
    base: '0,10,15',
    trail: 0.08,
    colors: [
      'rgba(119,195,156,0.52)',
      'rgba(47,94,54,0.5)',
      'rgba(85,171,165,0.48)',
      'rgba(45,112,99,0.46)',
      'rgba(63,104,41,0.44)',
      'rgba(68,168,114,0.42)',
      'rgba(33,89,100,0.4)',
      'rgba(205,237,174,0.32)',
    ],
  },
  // 梵高星夜 1889：深蓝夜空 + 金黄星光
  starry: {
    base: '6,13,26',
    trail: 0.075,
    colors: [
      'rgba(27,59,111,0.5)',
      'rgba(40,89,148,0.48)',
      'rgba(65,130,184,0.46)',
      'rgba(107,174,214,0.42)',
      'rgba(247,208,70,0.3)',
      'rgba(224,159,62,0.34)',
      'rgba(255,238,219,0.28)',
    ],
  },
  // 猎户星云
  nebula: {
    base: '8,5,18',
    trail: 0.075,
    colors: [
      'rgba(60,22,66,0.48)',
      'rgba(108,45,122,0.46)',
      'rgba(153,55,122,0.44)',
      'rgba(200,90,128,0.4)',
      'rgba(224,141,172,0.34)',
      'rgba(162,136,227,0.36)',
      'rgba(252,246,189,0.3)',
    ],
  },
  // 晨：暖金香案
  dawn: {
    base: '14,10,6',
    trail: 0.075,
    colors: [
      'rgba(232,201,138,0.5)',
      'rgba(200,138,74,0.46)',
      'rgba(245,226,192,0.38)',
      'rgba(176,122,60,0.4)',
      'rgba(217,176,106,0.34)',
      'rgba(255,217,138,0.3)',
    ],
  },
  // 墨：骨白
  ink: {
    base: '12,12,12',
    trail: 0.075,
    colors: [
      'rgba(216,212,200,0.42)',
      'rgba(168,164,154,0.38)',
      'rgba(234,231,222,0.32)',
      'rgba(140,136,126,0.32)',
      'rgba(192,188,176,0.28)',
      'rgba(120,116,108,0.24)',
    ],
  },
  // 霞：落日霞红
  dusk: {
    base: '16,9,7',
    trail: 0.075,
    colors: [
      'rgba(240,160,112,0.48)',
      'rgba(224,120,74,0.44)',
      'rgba(255,210,176,0.36)',
      'rgba(192,90,58,0.36)',
      'rgba(245,188,148,0.3)',
      'rgba(210,101,60,0.26)',
    ],
  },
}

/** 主题 → 默认调色盘：夜用梵高星夜最贴，其余用同色系 */
const THEME_PALETTE: { [k: string]: string } = {
  dawn: 'dawn',
  night: 'starry',
  ink: 'ink',
  dusk: 'dusk',
}

function paletteOf(theme: string, want: string): SkyPalette {
  const key = want && want !== 'auto' ? want : THEME_PALETTE[theme] || 'dawn'
  return PALETTES[key] || PALETTES.dawn
}

// —— 经典柏林噪声（参考实现的标准置换表）——
const PERM = new Uint8Array(512)
;(function seedPerm() {
  const permutation = [
    151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142,
    8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203,
    117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74,
    165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220,
    105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132,
    187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3,
    64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227,
    47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221,
    153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185,
    112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51,
    145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121,
    50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78,
    66, 215, 61, 156, 180,
  ]
  for (let i = 0; i < 256; i++) {
    PERM[i] = permutation[i]
    PERM[256 + i] = permutation[i]
  }
})()

function grad2(hash: number, gx: number, gy: number): number {
  const h = hash & 7
  const uu = h < 4 ? gx : gy
  const vv = h < 4 ? gy : gx
  return ((h & 1) === 0 ? uu : -uu) + ((h & 2) === 0 ? vv : -vv)
}

/** 返回 0..1，与参考实现 noise2D 等价 */
function noise2(x: number, y: number): number {
  const fx = Math.floor(x)
  const fy = Math.floor(y)
  const X = fx & 255
  const Y = fy & 255
  const xf = x - fx
  const yf = y - fy
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
  const A = PERM[X] + Y
  const B = PERM[X + 1] + Y
  const a0 = grad2(PERM[A], xf, yf)
  const b0 = grad2(PERM[B], xf - 1, yf)
  const a1 = grad2(PERM[A + 1], xf, yf - 1)
  const b1 = grad2(PERM[B + 1], xf - 1, yf - 1)
  const x1 = a0 + u * (b0 - a0)
  const x2 = a1 + u * (b1 - a1)
  // 归一化到 0..1
  return (x1 + v * (x2 - x1) + 1) * 0.5
}

interface Particle {
  x: number
  y: number
  c: number
}

/**
 * 粒子数按屏幕面积算：参考实现写死 1200 是给 375 屏的，
 * 但在真机上密度过高会糊住菜单。这里按 0.0015 颗/px² 铺，
 * 375×667 约 375 颗、间距约 26px，出流场形态又不抢前景。
 */
function particleCount(w: number, h: number): number {
  const area = Math.max(1, w * h)
  let n = Math.round(area * 0.0015)
  n = Math.max(200, Math.min(n, 900))
  let level = -1
  try {
    level = Number((wx.getSystemInfoSync() as any).benchmarkLevel)
  } catch (e) {
    level = -1
  }
  if (level > 0 && level < 20) n = Math.round(n * 0.7)
  return n
}

/** 星点直径跟着屏幕宽度微调，小屏别糊成一片 */
function dotRadiusOf(w: number): number {
  return Math.max(1.1, Math.min((w / 375) * DOT_RADIUS, 1.8))
}

Component({
  properties: {
    /** 跟随香案主题换色 */
    theme: {
      type: String,
      value: 'dawn',
    },
    /** auto 跟随主题；也可指定 emerald / starry / nebula / dawn / ink / dusk */
    palette: {
      type: String,
      value: 'auto',
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
    'theme, palette'(theme: string, palette: string) {
      const s: any = this
      if (!s._inited) return
      s.applyPalette(paletteOf(theme, palette))
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
          s._dot = dotRadiusOf(info.width)
          s._pal = paletteOf(s.data.theme, s.data.palette)

          canvas.width = Math.floor(info.width * dpr)
          canvas.height = Math.floor(info.height * dpr)
          ctx.scale(dpr, dpr)

          s._sprites = this.buildSprites()
          s._pts = this.makeParticles(particleCount(info.width, info.height))

          // 首帧铺底色，避免从白屏渐变过来
          ctx.fillStyle = 'rgb(' + s._pal.base + ')'
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

    /** 换调色盘：重建 sprite 并清屏，避免旧主题拖尾残留 */
    applyPalette(pal: SkyPalette) {
      const s: any = this
      s._pal = pal
      s._sprites = this.buildSprites()
      if (s._ctx) {
        s._ctx.fillStyle = 'rgb(' + pal.base + ')'
        s._ctx.fillRect(0, 0, s._w, s._h)
      }
    },

    /** 预渲染各色小圆，绘制时用 drawImage 比逐颗 arc 快很多 */
    buildSprites(): any[] | null {
      const s: any = this
      const anyWx: any = wx
      if (typeof anyWx.createOffscreenCanvas !== 'function' || !s._pal) return null
      const colors: string[] = s._pal.colors
      const d = Math.ceil((s._dot || DOT_RADIUS) + 1)
      const out: any[] = []
      for (let i = 0; i < colors.length; i++) {
        try {
          const oc = anyWx.createOffscreenCanvas({ type: '2d', width: d * 2, height: d * 2 })
          const octx = oc.getContext('2d')
          octx.fillStyle = colors[i]
          octx.beginPath()
          octx.arc(d, d, s._dot || DOT_RADIUS, 0, Math.PI * 2)
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
      const total = (s._pal && s._pal.colors.length) || 1
      const pts: Particle[] = []
      for (let i = 0; i < n; i++) {
        pts.push({
          x: Math.random() * w,
          y: Math.random() * h,
          c: Math.floor(Math.random() * total),
        })
      }
      return pts
    },

    start() {
      const s: any = this
      if (!s._inited || s._running) return
      s._running = true
      s._raf = s._canvas.requestAnimationFrame(() => s.tick())
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
      const pal: SkyPalette = s._pal
      const d = Math.ceil((s._dot || DOT_RADIUS) + 1)

      // 半透明底色叠一层：旧帧衰减成拖尾
      ctx.fillStyle = 'rgba(' + pal.base + ',' + pal.trail + ')'
      ctx.fillRect(0, 0, w, h)

      const spin = Math.PI * 2 * MOVE_SCALE
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]
        // 高频相位缠绕：noise 值放大到 2π×750，角度抖动足够碎
        const angle = noise2(p.x / MOVE_SCALE, p.y / MOVE_SCALE) * spin
        p.x += Math.cos(angle) * MOVE_SPEED
        p.y += Math.sin(angle) * MOVE_SPEED

        // 边缘循环重置，避免全部飞出画布后画面静止
        if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
          p.x = Math.random() * w
          p.y = Math.random() * h
        }

        if (sprites) {
          ctx.drawImage(sprites[p.c], p.x - d, p.y - d, d * 2, d * 2)
        } else {
          ctx.fillStyle = pal.colors[p.c]
          ctx.fillRect(p.x, p.y, s._dot * 2, s._dot * 2)
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
