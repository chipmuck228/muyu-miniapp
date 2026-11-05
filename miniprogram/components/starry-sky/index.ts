// 主页星空：Canvas 2D 复刻 p5 流场星尘（小程序没有 DOM，p5 无法直接运行）
// 效果对应参考实现的三个要素：柏林噪声流场角度、低透明度全屏叠色拖尾、边界重置
import { winInfo } from '../../utils/util'

const MOVE_SPEED = 0.4
const MOVE_SCALE = 800
/** 每帧盖一层底色做拖尾，与参考实现的 20/255 一致 */
const TRAIL_ALPHA = 0.075

/**
 * 每个主题一套星尘配色与底色：星夜层要跟系统主题同色系，
 * 否则暖金香案上飘一片翡翠绿，跟界面完全脱节。
 * 颜色都带透明度，整体压得比较淡，不抢菜单和木鱼。
 */
interface SkyTheme {
  /** 拖尾/底色，rgb 三元组 */
  base: string
  /** 星尘颜色（rgba） */
  colors: string[]
}

const SKY_THEMES: { [k: string]: SkyTheme } = {
  // 晨：暖金香案，星尘取琥珀与米金
  dawn: {
    base: '14,10,6',
    colors: [
      'rgba(232,201,138,0.60)',
      'rgba(200,138,74,0.52)',
      'rgba(245,226,192,0.46)',
      'rgba(176,122,60,0.44)',
      'rgba(217,176,106,0.38)',
      'rgba(255,217,138,0.34)',
    ],
  },
  // 夜：月下银蓝
  night: {
    base: '5,7,12',
    colors: [
      'rgba(198,216,246,0.58)',
      'rgba(111,147,196,0.50)',
      'rgba(223,233,250,0.44)',
      'rgba(134,166,207,0.42)',
      'rgba(159,184,220,0.36)',
      'rgba(77,109,155,0.32)',
    ],
  },
  // 墨：只留骨白，几乎无色相
  ink: {
    base: '12,12,12',
    colors: [
      'rgba(216,212,200,0.46)',
      'rgba(168,164,154,0.40)',
      'rgba(234,231,222,0.36)',
      'rgba(140,136,126,0.34)',
      'rgba(192,188,176,0.30)',
      'rgba(120,116,108,0.26)',
    ],
  },
  // 霞：落日霞红
  dusk: {
    base: '16,9,7',
    colors: [
      'rgba(240,160,112,0.56)',
      'rgba(224,120,74,0.50)',
      'rgba(255,210,176,0.42)',
      'rgba(192,90,58,0.40)',
      'rgba(245,188,148,0.34)',
      'rgba(210,101,60,0.30)',
    ],
  },
}

function skyThemeOf(id: string): SkyTheme {
  return SKY_THEMES[id] || SKY_THEMES.dawn
}

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

/**
 * 按屏幕面积算粒子数，而不是写死 2000：
 * 参考实现跑在桌面浏览器上（1400×900 ≈ 126 万像素），手机上只有 25 万，
 * 同样 2000 颗会挤成一片噪点，看不出流场形态。
 * 目标密度 0.0026 颗/px²：375×667 约 650 颗，间距约 20px，能看清星尘走向。
 */
function particleCount(w: number, h: number): number {
  const area = Math.max(1, w * h)
  let n = Math.round(area * 0.0026)
  n = Math.max(320, Math.min(n, 1400))
  // 低端机再降一档，优先保住帧率
  let level = -1
  try {
    level = Number((wx.getSystemInfoSync() as any).benchmarkLevel)
  } catch (e) {
    level = -1
  }
  if (level > 0 && level < 20) n = Math.round(n * 0.7)
  return n
}

/** 星点直径跟着屏幕宽度走，小屏别糊成一片 */
function dotSize(w: number): number {
  const s = (w / 375) * 2.6
  return Math.max(2.0, Math.min(s, 3.4))
}

Component({
  properties: {
    /** 跟随香案主题换色 */
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
    theme(id: string) {
      const s: any = this
      if (!s._inited) return
      s._theme = skyThemeOf(id)
      s._sprites = s.buildSprites()
      // 底色变了，清一次屏，避免旧主题的拖尾残留
      s._ctx.fillStyle = 'rgb(' + s._theme.base + ')'
      s._ctx.fillRect(0, 0, s._w, s._h)
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
          s._theme = skyThemeOf(s.data.theme)
          s._dot = dotSize(info.width)

          canvas.width = Math.floor(info.width * dpr)
          canvas.height = Math.floor(info.height * dpr)
          ctx.scale(dpr, dpr)

          s._sprites = this.buildSprites()
          s._pts = this.makeParticles(particleCount(info.width, info.height))

          // 第一帧直接铺底色，避免从白屏渐变过来
          ctx.fillStyle = 'rgb(' + s._theme.base + ')'
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

    /** 预渲染各色小圆，绘制时用 drawImage 比逐个 arc 快很多 */
    buildSprites(): any[] | null {
      const s: any = this
      const anyWx: any = wx
      if (typeof anyWx.createOffscreenCanvas !== 'function' || !s._theme) return null
      const colors: string[] = s._theme.colors
      const d = Math.ceil((s._dot || 2.6) + 2)
      const out: any[] = []
      for (let i = 0; i < colors.length; i++) {
        try {
          const oc = anyWx.createOffscreenCanvas({ type: '2d', width: d * 2, height: d * 2 })
          const octx = oc.getContext('2d')
          octx.fillStyle = colors[i]
          octx.beginPath()
          octx.arc(d, d, s._dot || 1.3, 0, Math.PI * 2)
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
          c: Math.floor(Math.random() * s._theme.colors.length),
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
      const colors: string[] = s._theme.colors
      const d = Math.ceil((s._dot || 2.6) + 2)

      // 半透明底色叠一层：旧帧自然衰减成拖尾
      ctx.fillStyle = 'rgba(' + s._theme.base + ',' + TRAIL_ALPHA + ')'
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
          ctx.drawImage(sprites[p.c], p.x - d, p.y - d, d * 2, d * 2)
        } else {
          ctx.fillStyle = colors[p.c]
          ctx.fillRect(p.x, p.y, s._dot, s._dot)
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
