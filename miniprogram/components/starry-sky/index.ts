// 主页星夜背景：原生 Canvas 2D 流场星尘（参考实现的等价移植）
//
// 关键约束：canvas 在部分机型上会被系统提到最上层，压住界面。
// 所以这版**不铺底色**，画布始终透明，只画星点；拖尾用
// destination-out 低透明度擦除实现，而不是整屏叠色。
// 这样即使被置顶，也只有稀疏的星点浮在上面，菜单文字照样看得清。
import { winInfo } from '../../utils/util'

const MOVE_SCALE = 800
/** 星点半径（直径 2.8px） */
const DOT_RADIUS = 1.4
/** 默认每帧擦除比例，越小拖尾越长（对应 12/255） */
const TRAIL = 12 / 255

interface SkyPalette {
  colors: string[]
}

// —— 经典 3D 柏林噪声 (Ken Perlin Improved Noise，与 StarryCanvas.tsx 中的 p5.noise 严格对齐) ——
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

function grad3(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15
  const u = h < 8 ? x : y
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
}

function noise(x: number, y: number = 0, z: number = 0): number {
  const fx = Math.floor(x)
  const fy = Math.floor(y)
  const fz = Math.floor(z)
  const X = fx & 255
  const Y = fy & 255
  const Z = fz & 255
  const xf = x - fx
  const yf = y - fy
  const zf = z - fz
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
  const w = zf * zf * zf * (zf * (zf * 6 - 15) + 10)

  const A = PERM[X] + Y
  const AA = PERM[A] + Z
  const AB = PERM[A + 1] + Z
  const B = PERM[X + 1] + Y
  const BA = PERM[B] + Z
  const BB = PERM[B + 1] + Z

  const a0 = grad3(PERM[AA], xf, yf, zf)
  const b0 = grad3(PERM[BA], xf - 1, yf, zf)
  const a1 = grad3(PERM[AB], xf, yf - 1, zf)
  const b1 = grad3(PERM[BB], xf - 1, yf - 1, zf)
  const a2 = grad3(PERM[AA + 1], xf, yf, zf - 1)
  const b2 = grad3(PERM[BA + 1], xf - 1, yf, zf - 1)
  const a3 = grad3(PERM[AB + 1], xf, yf - 1, zf - 1)
  const b3 = grad3(PERM[BB + 1], xf - 1, yf - 1, zf - 1)

  const x1 = a0 + u * (b0 - a0)
  const x2 = a1 + u * (b1 - a1)
  const y1 = x1 + v * (x2 - x1)

  const x3 = a2 + u * (b2 - a2)
  const x4 = a3 + u * (b3 - a3)
  const y2 = x3 + v * (x4 - x3)

  return (y1 + w * (y2 - y1) + 1) * 0.5
}

/**
 * 严格按照 src/components/StarryCanvas.tsx 移植的 14 套动力学 / 热力学本征速度场
 */
function computeDelta(
  model: string,
  px: number,
  py: number,
  moveSpeed: number,
  moveScale: number,
  w: number,
  h: number,
  halfW: number,
  halfH: number,
  frameCount: number,
  hole1X: number,
  hole1Y: number,
  hole2X: number,
  hole2Y: number,
  tgK: number,
  northX: number,
  northY: number,
  southX: number,
  southY: number,
  invWPi: number,
  invHPi: number
): { dx: number; dy: number } {
  switch (model) {
    case 'phaseWrap':
    case 'perlin': {
      // 1. 原版高频相位缠绕 (Van Gogh Turbulence with Subtle 3D Time Drift)
      const timeDrift = frameCount * 0.00025
      const angle = noise(px / moveScale, py / moveScale, timeDrift) * Math.PI * 2 * moveScale
      return { dx: Math.cos(angle) * moveSpeed, dy: Math.sin(angle) * moveSpeed }
    }

    case 'curlFluid':
    case 'curl': {
      // 2. 旋度不可压缩流体 (Incompressible Curl Noise Fluid: ∇ · v = 0)
      const eps = 3
      const nY1 = noise(px / moveScale, (py + eps) / moveScale)
      const nY0 = noise(px / moveScale, (py - eps) / moveScale)
      const nX1 = noise((px + eps) / moveScale, py / moveScale)
      const nX0 = noise((px - eps) / moveScale, py / moveScale)
      const curlX = (nY1 - nY0) / (2 * eps)
      const curlY = -(nX1 - nX0) / (2 * eps)
      const curlMag = Math.sqrt(curlX * curlX + curlY * curlY) || 0.0001
      return { dx: (curlX / curlMag) * moveSpeed * 1.5, dy: (curlY / curlMag) * moveSpeed * 1.5 }
    }

    case 'rayleighBenard':
    case 'benard': {
      // 3. 瑞利-贝纳德热对流胞 (Rayleigh-Bénard Convection Cells)
      const nRolls = 4
      const uK = (Math.PI * nRolls) / w
      const vK = Math.PI / h
      const vxConvect = Math.sin(uK * px) * Math.cos(vK * py)
      const vyConvect = -Math.cos(uK * px) * Math.sin(vK * py)
      const tempGrad = (h - py) / h
      const buoyancy = (tempGrad - 0.5) * 0.45
      const tNoise = (noise(px / moveScale, py / moveScale) - 0.5) * 0.3
      return { dx: (vxConvect + tNoise) * moveSpeed * 1.5, dy: (vyConvect - buoyancy + tNoise) * moveSpeed * 1.5 }
    }

    case 'brownianMotion':
    case 'langevin': {
      // 4. 朗之万布朗热运动 (Langevin Equation & Brownian Thermal Motion)
      const dAngle = noise(px / moveScale, py / moveScale) * Math.PI * 4
      const driftX = Math.cos(dAngle) * 0.55
      const driftY = Math.sin(dAngle) * 0.55
      const randAng = Math.random() * Math.PI * 2
      const randAmp = Math.sqrt(-2.0 * Math.log(Math.max(0.0001, Math.random())))
      return {
        dx: (driftX + Math.cos(randAng) * randAmp * 0.75) * moveSpeed * 1.4,
        dy: (driftY + Math.sin(randAng) * randAmp * 0.75) * moveSpeed * 1.4,
      }
    }

    case 'thermalEntropy':
    case 'fourier': {
      // 5. 傅里叶热传导与熵增温度梯度 (Heat Conduction & Entropy Gradient)
      const rxH = px - halfW
      const ryH = py - halfH
      const dH = Math.sqrt(rxH * rxH + ryH * ryH) + 1.0
      const gTx = rxH / dH
      const gTy = ryH / dH
      const hFlux = Math.min(2.5, 320 / (dH + 40))
      const entPerturb = noise(px / moveScale, py / moveScale) * Math.PI * 2
      return {
        dx: (gTx * hFlux - gTy * 0.45 + Math.cos(entPerturb) * 0.3) * moveSpeed,
        dy: (gTy * hFlux + gTx * 0.45 + Math.sin(entPerturb) * 0.3) * moveSpeed,
      }
    }

    case 'maxwellBoltzmann':
    case 'maxwell': {
      // 6. 麦克斯韦-玻尔兹曼气体热膨胀 (Maxwell-Boltzmann Gas Expansion)
      const rxM = px - halfW
      const ryM = py - halfH
      const distM = Math.sqrt(rxM * rxM + ryM * ryM) + 1.0
      const radAng = Math.atan2(ryM, rxM)
      const expF = Math.min(2.2, 550 / (distM + 70))
      const mbV = noise(px * 0.005, py * 0.005, frameCount * 0.005) + 0.45
      return { dx: Math.cos(radAng) * expF * mbV * moveSpeed, dy: Math.sin(radAng) * expF * mbV * moveSpeed }
    }

    case 'cliffordAttractor':
    case 'clifford': {
      // 7. 克利福德奇异吸引子 (Clifford Strange Attractor)
      const nx = (px - halfW) / (halfW * 0.45)
      const ny = (py - halfH) / (halfH * 0.45)
      const ca = -1.4, cb = 1.6, cc = 1.0, cd = 0.7
      const targetX = Math.sin(ca * ny) + cc * Math.cos(ca * nx)
      const targetY = Math.sin(cb * nx) + cd * Math.cos(cb * ny)
      const targetAngle = Math.atan2(targetY - ny, targetX - nx)
      const noisePerturb = (noise(px / moveScale, py / moveScale) - 0.5) * 1.2
      const angle = targetAngle + noisePerturb
      return { dx: Math.cos(angle) * moveSpeed, dy: Math.sin(angle) * moveSpeed }
    }

    case 'binaryOrbit':
    case 'binary': {
      // 8. 双星/双黑洞引力轨 (Binary Gravitational Orbit with Anti-Stagnation Swirl，与 StarryCanvas.tsx 完全一致)
      const d1x = hole1X - px, d1y = hole1Y - py
      const dist1 = Math.sqrt(d1x * d1x + d1y * d1y) + 32
      const d2x = hole2X - px, d2y = hole2Y - py
      const dist2 = Math.sqrt(d2x * d2x + d2y * d2y) + 32

      const force1 = 1450 / (dist1 * dist1)
      const force2 = 1450 / (dist2 * dist2)

      const fx = (d1x / dist1) * force1 * 0.52 + (-d1y / dist1) * force1 * 1.48 +
                 (d2x / dist2) * force2 * 0.52 + (-d2y / dist2) * force2 * 1.48
      const fy = (d1y / dist1) * force1 * 0.52 + (d1x / dist1) * force1 * 1.48 +
                 (d2y / dist2) * force2 * 0.52 + (d2x / dist2) * force2 * 1.48

      // 磁旋转热压扩散微扰 (杜绝静态拉格朗日四点聚集)
      const thermalAngle = noise(px * 0.005, py * 0.005, frameCount * 0.002) * Math.PI * 4
      const thermalDispersion = (Math.random() - 0.5) * 0.15
      return {
        dx: fx + Math.cos(thermalAngle) * (moveSpeed * 0.38) + thermalDispersion,
        dy: fy + Math.sin(thermalAngle) * (moveSpeed * 0.38) + thermalDispersion,
      }
    }

    case 'cosmicVortex':
    case 'spiral': {
      // 9. 银河对数螺旋臂 (Logarithmic Spiral Galaxy Arms)
      const rx = px - halfW
      const ry = py - halfH
      const theta = Math.atan2(ry, rx)
      const spiralAngle = theta + Math.PI / 2 + 0.32
      const baseNoise = noise(px / moveScale, py / moveScale) * Math.PI * 2
      const angle = spiralAngle * 0.72 + baseNoise * 0.28
      return { dx: Math.cos(angle) * moveSpeed, dy: Math.sin(angle) * moveSpeed }
    }

    case 'taylorGreenGyre':
    case 'taylor': {
      // 10. 泰勒-格林大洋中尺度涡 (Taylor-Green Oceanic Gyres)
      const tgX = Math.sin(tgK * px) * Math.cos(tgK * py)
      const tgY = -Math.cos(tgK * px) * Math.sin(tgK * py)
      const nAngle = noise(px / moveScale, py / moveScale) * Math.PI * 4
      return {
        dx: (tgX * 0.8 + Math.cos(nAngle) * 0.2) * moveSpeed * 1.6,
        dy: (tgY * 0.8 + Math.sin(nAngle) * 0.2) * moveSpeed * 1.6,
      }
    }

    case 'chladniWave':
    case 'chladni': {
      // 11. 克拉尼声波驻波共振节线 (Chladni Cymatic Standing Waves)
      const u = px * invWPi
      const v = py * invHPi
      const dWdu = -3 * Math.sin(3 * u) * Math.cos(5 * v) + 5 * Math.sin(5 * u) * Math.cos(3 * v)
      const dWdv = -5 * Math.cos(3 * u) * Math.sin(5 * v) + 3 * Math.cos(5 * u) * Math.sin(3 * v)
      const cymaticAngle = Math.atan2(dWdu, -dWdv)
      const waveNoise = (noise(px / moveScale, py / moveScale) - 0.5) * 1.2
      const angle = cymaticAngle + waveNoise
      return { dx: Math.cos(angle) * moveSpeed, dy: Math.sin(angle) * moveSpeed }
    }

    case 'magneticDipole':
    case 'dipole': {
      // 12. 磁偶极子通量线 (Magnetic Dipole Field Lines)
      const rNx = px - northX, rNy = py - northY
      const distN = Math.sqrt(rNx * rNx + rNy * rNy) + 25
      const rSx = px - southX, rSy = py - southY
      const distS = Math.sqrt(rSx * rSx + rSy * rSy) + 25
      const bx = (rNx / (distN * distN * distN)) - (rSx / (distS * distS * distS))
      const by = (rNy / (distN * distN * distN)) - (rSy / (distS * distS * distS))
      const bAngle = Math.atan2(by, bx)
      const dipoleNoise = (noise(px / moveScale, py / moveScale) - 0.5) * 0.8
      const angle = bAngle + dipoleNoise
      return { dx: Math.cos(angle) * moveSpeed, dy: Math.sin(angle) * moveSpeed }
    }

    case 'solarCorona':
    case 'solar': {
      // 13. 日冕喷发与太阳风 (Solar Corona Ejection & Coronal Mass Loops)
      const rx = px - halfW
      const ry = py - halfH
      const radDist = Math.sqrt(rx * rx + ry * ry) + 1
      const radAngle = Math.atan2(ry, rx)
      const flareNoise = noise(px / moveScale, py / moveScale, frameCount * 0.006)
      const twist = Math.sin(radDist * 0.02 + flareNoise * Math.PI) * 1.2
      const angle = radAngle + twist
      return { dx: Math.cos(angle) * (moveSpeed * 1.2), dy: Math.sin(angle) * (moveSpeed * 1.2) }
    }

    case 'smoothStream':
    case 'laminar':
    default: {
      // 14. 平滑天河层流 (Smooth Laminar River)
      const angle = noise(px / moveScale, py / moveScale) * Math.PI * 8
      return { dx: Math.cos(angle) * moveSpeed, dy: Math.sin(angle) * moveSpeed }
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



interface Particle {
  x: number
  y: number
  c: number
  age: number
  maxAge: number
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
    /** 动力学 / 热力学模型 id，默认启用双黑洞引力吸积模型 */
    field: {
      type: String,
      value: 'binary',
    },
    /** 拖尾余晖衰减 0~255：0 = 几乎不衰减（长轨迹），255 = 每帧擦净（无拖尾） */
    trail: {
      type: Number,
      value: 12,
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
          // 发光点：亮核 + 快速衰减的柔边。
          // 实心圆排成轨迹是一条硬边实线，在深底上就是"重重的笔触"；
          // 渐变点的边缘是透明的，轨迹变成中心亮、两侧渐散的光带
          const m = parseRgba(colors[i])
          const mk = (al: number) =>
            'rgba(' + Math.round(m[0]) + ',' + Math.round(m[1]) + ',' + Math.round(m[2]) + ',' + al.toFixed(3) + ')'
          const rad = s._dot || DOT_RADIUS
          const grd = octx.createRadialGradient(d, d, 0, d, d, rad)
          grd.addColorStop(0, mk(Math.min(1, m[3] * 0.95)))
          grd.addColorStop(0.45, mk(m[3] * 0.4))
          grd.addColorStop(1, mk(0))
          octx.fillStyle = grd
          octx.fillRect(0, 0, d * 2, d * 2)
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
          age: Math.floor(Math.random() * 600),
          maxAge: Math.floor(700 + Math.random() * 800),
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

      // 擦除上一帧的一部分：留下渐隐的拖尾余晖，画布本身仍然透明
      let dotA = 1
      if (s._trim) {
        const trailA = s._trailA != null ? s._trailA : TRAIL
        // 255 档：每帧直接清屏，不留任何拖尾
        if (trailA >= 0.999) {
          ctx.clearRect(0, 0, w, h)
        } else {
          // 指数插值把 0..1 映射到擦除率：trail 默认 12 档对应真实 12/255 衰减比例
          const speedK = (s._speed || 0.25) / 0.25
          const alpha = Math.min(1, 0.0136 * Math.pow(73.5, trailA) * speedK)
          ctx.globalCompositeOperation = 'destination-out'
          ctx.fillStyle = 'rgba(0,0,0,' + alpha.toFixed(4) + ')'
          ctx.fillRect(0, 0, w, h)
          ctx.globalCompositeOperation = 'source-over'
          dotA = 0.4 + 0.6 * Math.min(1, trailA / 0.35)
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

      const d = Math.ceil((s._dot || DOT_RADIUS) + 1)
      const vx = s._vortex
      const vorR = 160
      const vorR2 = vorR * vorR
      const step = s._speed || 0.25
      s._frame = (s._frame || 0) + 1
      const frameCount = s._frame
      const model = s.data.field || 'binary'

      // 与 StarryCanvas.tsx 严格对齐的空间几何度量与时间常数
      const halfW = w / 2
      const halfH = h / 2
      const orbitWobble = 1 + 0.06 * Math.sin(frameCount * 0.016)
      const orbitR = Math.min(halfW, halfH) * 0.28 * orbitWobble
      const timeAngle = frameCount * 0.01
      const precession = frameCount * 0.0004
      const hole1X = halfW + Math.cos(timeAngle + precession) * orbitR
      const hole1Y = halfH + Math.sin(timeAngle + precession) * orbitR
      const hole2X = halfW - Math.cos(timeAngle - precession) * orbitR
      const hole2Y = halfH - Math.sin(timeAngle - precession) * orbitR

      const tgK = (Math.PI * 4) / Math.min(w, h)
      const poleDist = Math.min(halfW, halfH) * 0.35
      const northX = halfW - poleDist
      const northY = halfH
      const southX = halfW + poleDist
      const southY = halfH
      const invWPi = Math.PI / w
      const invHPi = Math.PI / h

      if (dotA < 0.999) ctx.globalAlpha = dotA
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]

        // 14 种动力学/热力学模型的本征位移向量（与 StarryCanvas.tsx 完全一致）
        const delta = computeDelta(
          model,
          p.x,
          p.y,
          step,
          MOVE_SCALE,
          w,
          h,
          halfW,
          halfH,
          frameCount,
          hole1X,
          hole1Y,
          hole2X,
          hole2Y,
          tgK,
          northX,
          northY,
          southX,
          southY,
          invWPi,
          invHPi
        )

        let dx = delta.dx
        let dy = delta.dy

        // 敲击或交互激发的漩涡力场
        if (vx && vx.life > 0.02) {
          const ddx = p.x - vx.x
          const ddy = p.y - vx.y
          const dd = ddx * ddx + ddy * ddy
          if (dd < vorR2 && dd > 4) {
            const dist = Math.sqrt(dd)
            const force = (1 - dist / vorR) * 2.5 * vx.life
            dx += (-ddy / dist) * force
            dy += (ddx / dist) * force
          }
        }

        p.x += dx
        p.y += dy
        p.age = (p.age || 0) + 1

        // 边界越界重置与生命周期自然重塑 (严格对齐 StarryCanvas.tsx 解决拓扑死点聚集停滞的工业级解法)
        if (p.x < 0 || p.x > w || p.y < 0 || p.y > h || p.age > p.maxAge) {
          p.x = Math.random() * w
          p.y = Math.random() * h
          p.age = 0
          p.maxAge = Math.floor(700 + Math.random() * 800)
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
      if (dotA < 0.999) ctx.globalAlpha = 1

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
