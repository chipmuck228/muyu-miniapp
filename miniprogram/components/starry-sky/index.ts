// 主页星夜背景：原生 Canvas 2D 流场星尘（参考实现的等价移植）
//
// 关键约束：canvas 在部分机型上会被系统提到最上层，压住界面。
// 所以这版**不铺底色**，画布始终透明，只画星点；拖尾用
// destination-out 低透明度擦除实现，而不是整屏叠色。
// 这样即使被置顶，也只有稀疏的星点浮在上面，菜单文字照样看得清。
import { winInfo } from '../../utils/util'

const MOVE_SPEED = 0.45
const MOVE_SCALE = 750
/** 星点半径（直径 2.8px） */
const DOT_RADIUS = 1.4
/** 每帧擦除比例，越小拖尾越长 */
const TRAIL = 0.07

interface SkyPalette {
  colors: string[]
}

/** 模型速度场的公共环境量，每帧算一次，循环内不再重复 */
interface FlowEnv {
  w: number
  h: number
  halfW: number
  halfH: number
  /** 累计帧数，驱动时间演化 */
  t: number
  /** 流速档位：每帧位移 px（对应文档的 moveSpeed） */
  step: number
  scale: number
  spin: number
  /** 双黑洞本帧的公转位置 */
  holes: number[][]
}

/**
 * 各动力学 / 热力学模型的本征速度向量（未按 step 缩放）。
 * tick 里统一做归一化后再乘流速档位，所以这里只关心方向场的形态，
 * 不必担心某个模型的输出幅度不一致。
 */
function flow(model: string, x: number, y: number, e: FlowEnv): { x: number; y: number } {
  const S = e.scale
  const n = noise2(x / S, y / S)
  switch (model) {
    // 2.2 旋度不可压缩流场：标量流函数的中心差分旋度，处处零散度
    case 'curl': {
      const eps = 3.0
      const nY1 = noise2(x / S, (y + eps) / S)
      const nY0 = noise2(x / S, (y - eps) / S)
      const nX1 = noise2((x + eps) / S, y / S)
      const nX0 = noise2((x - eps) / S, y / S)
      return { x: (nY1 - nY0) / (2 * eps), y: -(nX1 - nX0) / (2 * eps) }
    }
    // 2.3 泰勒-格林中尺度涡列（纳维-斯托克斯周期域解析解）+ 湍流微扰
    case 'taylor': {
      const k = (Math.PI * 4) / Math.min(e.w, e.h)
      const na = n * Math.PI * 4
      return {
        x: Math.sin(k * x) * Math.cos(k * y) * 0.8 + Math.cos(na) * 0.2,
        y: -Math.cos(k * x) * Math.sin(k * y) * 0.8 + Math.sin(na) * 0.2,
      }
    }
    // 2.4 低频层流：角度倍频降到 8π，流线平滑
    case 'laminar': {
      const a = n * Math.PI * 8
      return { x: Math.cos(a), y: Math.sin(a) }
    }
    // 3.1 瑞利-贝纳德热对流胞 + 垂直浮力（底热顶冷）
    case 'benard': {
      const uK = (Math.PI * 4) / e.w
      const vK = Math.PI / e.h
      const thermal = (n - 0.5) * 0.3
      const buoyancy = ((e.h - y) / e.h - 0.5) * 0.4
      return {
        x: Math.sin(uK * x) * Math.cos(vK * y) + thermal,
        y: -Math.cos(uK * x) * Math.sin(vK * y) - buoyancy + thermal,
      }
    }
    // 3.2 朗之万方程（过阻尼极限）：漂移场 + Box-Muller 高斯热涨落
    case 'langevin': {
      const da = n * Math.PI * 4
      const u1 = Math.max(0.0001, Math.random())
      const u2 = Math.random()
      const r = Math.sqrt(-2 * Math.log(u1))
      const T = 0.85
      return {
        x: Math.cos(da) * 0.6 + r * Math.cos(2 * Math.PI * u2) * T,
        y: Math.sin(da) * 0.6 + r * Math.sin(2 * Math.PI * u2) * T,
      }
    }
    // 3.3 傅里叶热传导：沿温度负梯度扩散 + 等温线切向环流
    case 'fourier': {
      const rX = x - e.halfW
      const rY = y - e.halfH
      const dist = Math.sqrt(rX * rX + rY * rY) + 1
      const gX = rX / dist
      const gY = rY / dist
      const flux = Math.min(2.5, 300 / (dist + 50))
      const ent = n * Math.PI * 2
      return {
        x: gX * flux - gY * 0.5 + Math.cos(ent) * 0.3,
        y: gY * flux + gX * 0.5 + Math.sin(ent) * 0.3,
      }
    }
    // 3.4 麦克斯韦-玻尔兹曼：核心高压的径向绝热膨胀
    case 'maxwell': {
      const rX = x - e.halfW
      const rY = y - e.halfH
      const r = Math.sqrt(rX * rX + rY * rY) + 1
      const force = Math.min(2.2, 500 / (r + 80))
      const mb = noise2(x * 0.005 + e.t * 0.005, y * 0.005) + 0.4
      return { x: (rX / r) * force * mb, y: (rY / r) * force * mb }
    }
    // 4.1 双黑洞引力轨 + 吸积盘切向角动量（软化 eps=35）
    case 'binary': {
      let fx = 0
      let fy = 0
      for (let i = 0; i < 2; i++) {
        const dxh = e.holes[i][0] - x
        const dyh = e.holes[i][1] - y
        const dist = Math.sqrt(dxh * dxh + dyh * dyh) + 35
        const f = 1400 / (dist * dist)
        // 径向引力在近洞处翻成斥力，形成一个稳定的吸积环：
        // 纯向心场 + 定步长没有离心力平衡，粒子必然塌缩成一个点，
        // 所以用「远吸近斥」把粒子锚在半径 ~75px 的环带上绕转
        const pull = Math.max(-0.45, Math.min(1, (dist - 110) / 140))
        fx += (dxh / dist) * f * 0.5 * pull + (-dyh / dist) * f * 1.4
        fy += (dyh / dist) * f * 0.5 * pull + (dxh / dist) * f * 1.4
      }
      const bg = n * Math.PI * 4
      return { x: fx + Math.cos(bg) * e.step * 0.35, y: fy + Math.sin(bg) * e.step * 0.35 }
    }
    // 4.2 林家翘-徐遐生密度波：对数螺旋切向流（螺距角约 18.5°）
    case 'spiral': {
      const theta = Math.atan2(y - e.halfH, x - e.halfW)
      const angle = (theta + Math.PI / 2 + 0.32) * 0.72 + n * Math.PI * 2 * 0.28
      return { x: Math.cos(angle), y: Math.sin(angle) }
    }
    // 4.3 太阳风：辐射状帕克流 + 磁绳扭转波（时间维用帧相位近似）
    case 'solar': {
      const rX = x - e.halfW
      const rY = y - e.halfH
      const rad = Math.sqrt(rX * rX + rY * rY) + 1
      const flare = noise2(x / S, y / S + e.t * 0.01)
      const angle = Math.atan2(rY, rX) + Math.sin(rad * 0.02 + flare * Math.PI) * 1.2
      return { x: Math.cos(angle), y: Math.sin(angle) }
    }
    // 5.1 克利福德奇异吸引子 (a=-1.4, b=1.6, c=1.0, d=0.7)
    case 'clifford': {
      const nx = (x - e.halfW) / (e.halfW * 0.45)
      const ny = (y - e.halfH) / (e.halfH * 0.45)
      const tx = Math.sin(-1.4 * ny) + Math.cos(-1.4 * nx)
      const ty = Math.sin(1.6 * nx) + 0.7 * Math.cos(1.6 * ny)
      const angle = Math.atan2(ty - ny, tx - nx) + (n - 0.5) * 1.2
      return { x: Math.cos(angle), y: Math.sin(angle) }
    }
    // 5.2 克拉尼驻波：微尘沿节线（W=0 等位线）沉降
    case 'chladni': {
      const u = x * (Math.PI / e.w)
      const v = y * (Math.PI / e.h)
      const dWdu = -3 * Math.sin(3 * u) * Math.cos(5 * v) + 5 * Math.sin(5 * u) * Math.cos(3 * v)
      const dWdv = -5 * Math.cos(3 * u) * Math.sin(5 * v) + 3 * Math.cos(5 * u) * Math.sin(3 * v)
      const angle = Math.atan2(dWdu, -dWdv) + (n - 0.5) * 1.2
      return { x: Math.cos(angle), y: Math.sin(angle) }
    }
    // 5.3 磁偶极子：两极磁通量线矢量和的切向
    case 'dipole': {
      const poleDist = Math.min(e.halfW, e.halfH) * 0.35
      const rNx = x - (e.halfW - poleDist)
      const rNy = y - e.halfH
      const rSx = x - (e.halfW + poleDist)
      const rSy = y - e.halfH
      const dN = Math.sqrt(rNx * rNx + rNy * rNy) + 25
      const dS = Math.sqrt(rSx * rSx + rSy * rSy) + 25
      const bx = rNx / (dN * dN * dN) - rSx / (dS * dS * dS)
      const by = rNy / (dN * dN * dN) - rSy / (dS * dS * dS)
      const angle = Math.atan2(by, bx) + (n - 0.5) * 0.8
      return { x: Math.cos(angle), y: Math.sin(angle) }
    }
    // 2.1 原版高频相位缠绕（默认）
    default: {
      const a = n * e.spin
      return { x: Math.cos(a), y: Math.sin(a) }
    }
  }
}

const PALETTES: { [k: string]: SkyPalette } = {
  // 翡翠极光（参考实现原版）
  emerald: {
    colors: [
      'rgba(119,195,156,0.62)',
      'rgba(47,94,54,0.6)',
      'rgba(85,171,165,0.58)',
      'rgba(45,112,99,0.56)',
      'rgba(63,104,41,0.54)',
      'rgba(68,168,114,0.52)',
      'rgba(33,89,100,0.5)',
      'rgba(205,237,174,0.42)',
    ],
  },
  // 梵高星夜 1889：深蓝夜空 + 金黄星光
  starry: {
    colors: [
      'rgba(58,104,170,0.6)',
      'rgba(74,132,196,0.58)',
      'rgba(110,178,220,0.54)',
      'rgba(150,204,236,0.5)',
      'rgba(247,208,70,0.4)',
      'rgba(224,159,62,0.44)',
      'rgba(255,238,219,0.36)',
    ],
  },
  // 猎户星云
  nebula: {
    colors: [
      'rgba(108,45,122,0.56)',
      'rgba(153,55,122,0.54)',
      'rgba(200,90,128,0.5)',
      'rgba(224,141,172,0.44)',
      'rgba(162,136,227,0.46)',
      'rgba(252,246,189,0.4)',
    ],
  },
  // 晨：暖金
  dawn: {
    colors: [
      'rgba(232,201,138,0.6)',
      'rgba(200,138,74,0.56)',
      'rgba(245,226,192,0.46)',
      'rgba(176,122,60,0.5)',
      'rgba(217,176,106,0.44)',
      'rgba(255,217,138,0.4)',
    ],
  },
  // 墨：骨白
  ink: {
    colors: [
      'rgba(216,212,200,0.5)',
      'rgba(168,164,154,0.46)',
      'rgba(234,231,222,0.4)',
      'rgba(140,136,126,0.4)',
      'rgba(192,188,176,0.36)',
    ],
  },
  // 霞：落日霞红
  dusk: {
    colors: [
      'rgba(240,160,112,0.58)',
      'rgba(224,120,74,0.54)',
      'rgba(255,210,176,0.44)',
      'rgba(192,90,58,0.46)',
      'rgba(245,188,148,0.4)',
    ],
  },
}

const THEME_PALETTE: { [k: string]: string } = {
  dawn: 'dawn',
  night: 'starry',
  ink: 'ink',
  dusk: 'dusk',
}

/** 定课推进时的目标色：暖金 */
const GOLD_COLORS = [
  'rgba(247,208,70,0.66)',
  'rgba(255,226,150,0.58)',
  'rgba(224,159,62,0.6)',
  'rgba(255,238,219,0.5)',
  'rgba(240,186,96,0.56)',
  'rgba(255,214,120,0.52)',
  'rgba(210,150,60,0.5)',
]

function parseRgba(str: string): number[] {
  const m = /rgba?\(([^)]+)\)/.exec(str)
  if (!m) return [255, 255, 255, 1]
  const p = m[1].split(',').map((v) => parseFloat(v))
  return [p[0] || 0, p[1] || 0, p[2] || 0, p[3] === undefined ? 1 : p[3]]
}

function mixColor(from: string, to: string, t: number): string {
  const a = parseRgba(from)
  const b = parseRgba(to)
  const r = Math.round(a[0] + (b[0] - a[0]) * t)
  const g = Math.round(a[1] + (b[1] - a[1]) * t)
  const bl = Math.round(a[2] + (b[2] - a[2]) * t)
  const al = a[3] + (b[3] - a[3]) * t
  return 'rgba(' + r + ',' + g + ',' + bl + ',' + al.toFixed(3) + ')'
}

/** 把一套冷色按 t 向金色过渡 */
function warmPalette(base: SkyPalette, t: number): SkyPalette {
  const colors = base.colors.map((c, i) => mixColor(c, GOLD_COLORS[i % GOLD_COLORS.length], t))
  return { colors }
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
  return (x1 + v * (x2 - x1) + 1) * 0.5
}

interface Particle {
  x: number
  y: number
  c: number
}

/**
 * 按屏幕面积算粒子数：参考实现写死 1200 是给 375 屏的，
 * 真机上过密会糊住菜单。mid 档 0.0018 颗/px²：375×667 约 450 颗。
 */
const DENSITY: { [k: string]: number } = {
  low: 0.0011,
  mid: 0.0018,
  high: 0.0028,
}

function particleCount(w: number, h: number, densityLevel?: string): number {
  const area = Math.max(1, w * h)
  const k = DENSITY[densityLevel || 'mid'] || DENSITY.mid
  let n = Math.round(area * k)
  n = Math.max(180, Math.min(n, 1200))
  // 低端机（benchmarkLevel < 20）降 30%，避免掉帧
  let bench = -1
  try {
    bench = Number((wx.getSystemInfoSync() as any).benchmarkLevel)
  } catch (e) {
    bench = -1
  }
  if (bench > 0 && bench < 20) n = Math.round(n * 0.7)
  return n
}

/** 星点直径跟着屏幕宽度微调 */
function dotRadiusOf(w: number): number {
  return Math.max(1.1, Math.min((w / 375) * DOT_RADIUS, 1.8))
}

Component({
  properties: {
    theme: {
      type: String,
      value: 'dawn',
    },
    /** auto 跟随主题；也可指定 emerald / starry / nebula / dawn / ink / dusk */
    palette: {
      type: String,
      value: 'auto',
    },
    active: {
      type: Boolean,
      value: true,
    },
    /** 密度档位：low / mid / high */
    density: {
      type: String,
      value: 'mid',
    },
    /** 暂停流动（省电 / 调试） */
    paused: {
      type: Boolean,
      value: false,
    },
    /** 敲击脉冲：页面每敲一下 +1，星夜亮一下 */
    pulse: {
      type: Number,
      value: 0,
    },
    /** 暖化程度 0..1：定课推进时冷色逐渐转金 */
    tint: {
      type: Number,
      value: 0,
    },
    /** 流速：每帧位移 px（缓 0.1 / 常 0.25 / 疾 0.45） */
    speed: {
      type: Number,
      value: 0.25,
    },
    /** 动力学 / 热力学模型 id，见 flow() */
    field: {
      type: String,
      value: 'perlin',
    },
    /** 拖尾余晖衰减 0~255：0 = 几乎不衰减（长轨迹），255 = 每帧擦净（无拖尾） */
    trail: {
      type: Number,
      value: 18,
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
    paused(v: boolean) {
      const s: any = this
      if (!s._inited) return
      if (v) s.stop()
      else if (s.data.active) s.start()
    },
    density() {
      const s: any = this
      if (!s._inited) return
      s._pts = s.makeParticles(particleCount(s._w, s._h, s.data.density))
      s._ctx.clearRect(0, 0, s._w, s._h)
    },
    pulse() {
      const s: any = this
      s._pulse = 1
      // 随机漩涡：敲击时有概率在某处卷起一股涡流
      if (s._inited && s._w && Math.random() < 0.45) {
        s._vortex = {
          x: s._w * (0.25 + Math.random() * 0.5),
          y: s._h * (0.2 + Math.random() * 0.55),
          life: 1,
        }
      }
    },
    tint(v: number) {
      const s: any = this
      if (!s._inited) return
      const t = Math.max(0, Math.min(1, v || 0))
      if (Math.abs(t - (s._tint || 0)) < 0.04) return
      s._tint = t
      // 只打标记，真正的换色在下一帧做：初始化路径上不碰 sprite 重建
      s._needWarm = true
    },
    speed(v: number) {
      const s: any = this
      s._speed = Math.max(0.05, Math.min(2, v || 0.25))
    },
    trail(v: number) {
      const s: any = this
      s._trailA = Math.max(0, Math.min(255, v || 0)) / 255
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
          s._dot = dotRadiusOf(info.width)
          s._tint = Math.max(0, Math.min(1, s.data.tint || 0))
          s._speed = Math.max(0.05, Math.min(2, s.data.speed || 0.25))
          s._trailA = Math.max(0, Math.min(255, s.data.trail || 0)) / 255
          s._base = paletteOf(s.data.theme, s.data.palette)

          canvas.width = Math.floor(info.width * dpr)
          canvas.height = Math.floor(info.height * dpr)
          ctx.scale(dpr, dpr)

          // 顺序很重要：先有调色盘和 sprite，再有粒子，最后才允许 start，
          // 否则任何一步抛错都会让 tick 拿着 undefined 循环，画面永远空白
          s._pal = s._base
          s._sprites = this.buildSprites()
          s._pts = this.makeParticles(particleCount(info.width, info.height, s.data.density))

          // 画布保持透明：不铺底色，靠 destination-out 擦出拖尾
          ctx.globalCompositeOperation = 'destination-out'
          s._trim = ctx.globalCompositeOperation === 'destination-out'
          ctx.globalCompositeOperation = 'source-over'

          s._inited = true
          if (s.data.active) s.start()
        })
    },

    /** 换调色盘：重建 sprite 并清屏 */
    applyPalette(pal: SkyPalette) {
      const s: any = this
      if (!pal || !pal.colors || !pal.colors.length) return
      s._base = pal
      const t = Math.max(0, Math.min(1, s._tint || 0))
      try {
        s._pal = t > 0.01 ? warmPalette(pal, t) : pal
      } catch (e) {
        s._pal = pal
      }
      s._sprites = this.buildSprites()
      if (s._ctx) s._ctx.clearRect(0, 0, s._w, s._h)
    },

    /** 重新撒一遍星尘（调参面板的「重置」） */
    reseed() {
      const s: any = this
      if (!s._inited) return
      s._pts = s.makeParticles(particleCount(s._w, s._h, s.data.density))
      s._ctx.clearRect(0, 0, s._w, s._h)
    },

    /** 预渲染各色小圆，drawImage 比逐颗 arc 快很多 */
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
      if (!ctx || !s._canvas || !pts || !pts.length || !pal || !pal.colors || !pal.colors.length) {
        s._raf = s._canvas.requestAnimationFrame(() => s.tick())
        return
      }

      // 擦除上一帧的一部分：留下渐隐的拖尾，画布本身仍然透明
      if (s._trim) {
        const trailA = s._trailA != null ? s._trailA : TRAIL
        // 255 档：每帧直接清屏，不留任何拖尾
        if (trailA >= 0.999) {
          ctx.clearRect(0, 0, w, h)
        } else {
          // 拖尾可见长度 L ≈ 3 * 每帧位移 / 擦除比例。
          // 两件事要同时成立：
          // 1) alpha 跟着流速缩放，L 才只由档位决定（否则缓速看不出余晖）
          // 2) 0 档不能真的为 0，否则轨迹永久堆积、几十秒后满屏根须
          // 用指数插值把 0..1 映射到擦除率：0 档 ≈ 95px 轨迹，255 档清屏
          const speedK = (s._speed || 0.25) / 0.25
          const alpha = Math.min(1, 0.008 * Math.pow(125, trailA) * speedK)
          ctx.globalCompositeOperation = 'destination-out'
          ctx.fillStyle = 'rgba(0,0,0,' + alpha.toFixed(4) + ')'
          ctx.fillRect(0, 0, w, h)
          ctx.globalCompositeOperation = 'source-over'
        }
      } else {
        ctx.clearRect(0, 0, w, h)
      }

      // 定课暖色：按标记在绘制前重建一次色板
      if (s._needWarm) {
        s._needWarm = false
        const t = Math.max(0, Math.min(1, s._tint || 0))
        const base = s._base || s._pal
        try {
          s._pal = t > 0.01 ? warmPalette(base, t) : base
        } catch (e) {
          s._pal = base
        }
        s._sprites = this.buildSprites()
      }

      const spin = Math.PI * 2 * MOVE_SCALE
      const d = Math.ceil((s._dot || DOT_RADIUS) + 1)
      const vx = s._vortex
      const vorR = 140
      const vorR2 = vorR * vorR
      // 流速档位直接就是每帧位移 px
      const step = s._speed || 0.25
      s._frame = (s._frame || 0) + 1
      const model = s.data.field || 'perlin'
      // 每帧只算一次的环境量（双黑洞位置等）
      const env: FlowEnv = {
        w: w,
        h: h,
        halfW: w / 2,
        halfH: h / 2,
        t: s._frame,
        step: step,
        scale: MOVE_SCALE,
        spin: spin,
        holes: [],
      }
      if (model === 'binary') {
        const orbitR = Math.min(w, h) * 0.28
        const ta = s._frame * 0.01
        env.holes = [
          [w / 2 + Math.cos(ta) * orbitR, h / 2 + Math.sin(ta) * orbitR],
          [w / 2 - Math.cos(ta) * orbitR, h / 2 - Math.sin(ta) * orbitR],
        ]
      }
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]
        if (model === 'perlin') {
          const angle = noise2(p.x / MOVE_SCALE, p.y / MOVE_SCALE) * spin
          p.x += Math.cos(angle) * step
          p.y += Math.sin(angle) * step
        } else {
          // 模型只给方向场，归一化后按流速档位走，各模型幅度天然一致
          const v = flow(model, p.x, p.y, env)
          const len = Math.sqrt(v.x * v.x + v.y * v.y) || 0.0001
          p.x += (v.x / len) * step
          p.y += (v.y / len) * step
        }

        // 漩涡：切向力把粒子卷向中心，随 life 衰减
        if (vx && vx.life > 0.02) {
          const ddx = p.x - vx.x
          const ddy = p.y - vx.y
          const dd = ddx * ddx + ddy * ddy
          if (dd < vorR2 && dd > 4) {
            const dist = Math.sqrt(dd)
            const f = (1 - dist / vorR) * 2.1 * vx.life
            p.x += (-ddy / dist) * f
            p.y += (ddx / dist) * f
          }
        }

        if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
          p.x = Math.random() * w
          p.y = Math.random() * h
        } else if (model === 'binary') {
          // 掉进视界内的粒子重新抛回外围，避免长期累积成两个亮点
          for (let k = 0; k < 2; k++) {
            const hx = p.x - env.holes[k][0]
            const hy = p.y - env.holes[k][1]
            if (hx * hx + hy * hy < 900) {
              const a = Math.random() * Math.PI * 2
              const r = 90 + Math.random() * Math.min(w, h) * 0.35
              p.x = env.holes[k][0] + Math.cos(a) * r
              p.y = env.holes[k][1] + Math.sin(a) * r
              break
            }
          }
        }

        if (sprites) {
          ctx.drawImage(sprites[p.c], p.x - d, p.y - d, d * 2, d * 2)
        } else {
          ctx.fillStyle = pal.colors[p.c]
          ctx.beginPath()
          ctx.arc(p.x, p.y, s._dot, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      if (s._vortex) {
        s._vortex.life *= 0.975
        if (s._vortex.life < 0.02) s._vortex = null
      }

      // 敲击脉冲：木鱼位置泛起一团暖光，随 _pulse 衰减
      const pulse = s._pulse || 0
      if (pulse > 0.03) {
        const cx = w / 2
        const cy = h * 0.56
        const rad = Math.max(w, h) * (0.2 + (1 - pulse) * 0.4)
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
        grd.addColorStop(0, 'rgba(255,214,150,' + (pulse * 0.16).toFixed(3) + ')')
        grd.addColorStop(0.55, 'rgba(255,214,150,' + (pulse * 0.05).toFixed(3) + ')')
        grd.addColorStop(1, 'rgba(255,214,150,0)')
        ctx.fillStyle = grd
        ctx.beginPath()
        ctx.arc(cx, cy, rad, 0, Math.PI * 2)
        ctx.fill()
        s._pulse = pulse * 0.9
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
