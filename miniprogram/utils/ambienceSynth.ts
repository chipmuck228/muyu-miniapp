// 付费氛围的离线合成：一次算好一段首尾无缝的立体声循环，交给 WebAudio 循环播放。
// 不依赖 wx，可以在 node 里渲染成 wav 试听（scripts/render-ambience.js）。
// 没有上传录音时用它兜底；有录音（audioCatalog.AUDIO_FILES）时优先播录音。

export type SynthId = 'noise' | 'stream' | 'pine' | 'fire'

/** 循环长度。所有慢变包络都取整数周期，保证首尾对得上 */
export const LOOP_SECONDS = 16
const XFADE_SECONDS = 1

/** 各氛围最终的响度（RMS），想整体调大调小改这里 */
const TARGET_RMS: Record<SynthId, number> = {
  noise: 0.03,
  stream: 0.034,
  pine: 0.034,
  fire: 0.03,
}

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 循环周期内的平滑起伏，取值约 [-1, 1]。cycles 是每个循环里的整数周期数 */
function slowWave(cycles: number[], weights: number[], seed: number): (t: number) => number {
  const r = rng(seed)
  const phase = cycles.map(() => r() * Math.PI * 2)
  let sum = 0
  for (let i = 0; i < weights.length; i++) sum += weights[i]
  return (t: number) => {
    let v = 0
    for (let i = 0; i < cycles.length; i++) {
      v += weights[i] * Math.sin((2 * Math.PI * cycles[i] * t) / LOOP_SECONDS + phase[i])
    }
    return v / sum
  }
}

function onePoleCoef(fc: number, sr: number): number {
  return 1 - Math.exp((-2 * Math.PI * fc) / sr)
}

/** 状态变量滤波器（TPT），截止频率可以逐块变化而不炸 */
class Svf {
  private ic1 = 0
  private ic2 = 0
  private a1 = 0
  private a2 = 0
  private a3 = 0
  private k = 1
  constructor(private sr: number) {}
  set(fc: number, q: number) {
    const g = Math.tan((Math.PI * Math.min(fc, this.sr * 0.45)) / this.sr)
    this.k = 1 / q
    this.a1 = 1 / (1 + g * (g + this.k))
    this.a2 = g * this.a1
    this.a3 = g * this.a2
  }
  /** 返回 [低通, 带通] */
  run(x: number, out: number[]) {
    const v3 = x - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    out[0] = v2
    out[1] = v1
  }
}

class Pink {
  private b0 = 0
  private b1 = 0
  private b2 = 0
  next(w: number): number {
    this.b0 = 0.99765 * this.b0 + w * 0.099046
    this.b1 = 0.963 * this.b1 + w * 0.2965164
    this.b2 = 0.57 * this.b2 + w * 1.0526913
    return (this.b0 + this.b1 + this.b2 + w * 0.1848) * 0.2
  }
}

class Brown {
  private y = 0
  next(w: number): number {
    this.y = (this.y + 0.02 * w) / 1.02
    return this.y * 3.5
  }
}

function rms(a: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * a[i]
  return Math.sqrt(s / Math.max(1, a.length)) || 1
}

/** 把 a 缩放到 RMS = target 后加到 dst 上 */
function mixIn(dst: Float32Array, a: Float32Array, target: number) {
  const k = target / rms(a)
  for (let i = 0; i < dst.length; i++) dst[i] += a[i] * k
}

// ---------- 各声音层（单声道，长度 n） ----------

function noiseBed(n: number, sr: number, seed: number): Float32Array {
  // 「白噪」用偏柔的粉噪，再削掉刺耳的高频
  const r = rng(seed)
  const pink = new Pink()
  const out = new Float32Array(n)
  const a = onePoleCoef(6500, sr)
  let lp = 0
  for (let i = 0; i < n; i++) {
    lp += a * (pink.next(r() * 2 - 1) - lp)
    out[i] = lp
  }
  return out
}

function streamBed(n: number, sr: number, seed: number): Float32Array {
  const r = rng(seed)
  const pink = new Pink()
  const svf = new Svf(sr)
  const tmp = [0, 0]
  const sweep = slowWave([3, 7, 12], [1, 0.6, 0.3], seed + 1)
  const swell = slowWave([2, 5, 11, 19], [1, 0.7, 0.4, 0.25], seed + 2)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    if ((i & 63) === 0) svf.set(900 * (1 + 0.28 * sweep(t)), 0.55)
    svf.run(pink.next(r() * 2 - 1), tmp)
    out[i] = tmp[1] * (0.72 + 0.28 * swell(t))
  }
  return out
}

function streamSplash(n: number, sr: number, seed: number): Float32Array {
  const r = rng(seed)
  const a = onePoleCoef(2600, sr)
  const env = slowWave([4, 9, 17, 29], [1, 0.8, 0.5, 0.4], seed + 3)
  let lp = 0
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1
    lp += a * (w - lp)
    const e = 0.5 + 0.5 * env(i / sr)
    out[i] = (w - lp) * e * e
  }
  return out
}

/** 水泡：音高上滑、迅速衰减的短正弦，是溪流「咕噜」感的来源 */
function bubbles(n: number, sr: number, seed: number, perSecond: number, pans: Float32Array): Float32Array {
  const r = rng(seed)
  const out = new Float32Array(n)
  const count = Math.round((n / sr) * perSecond)
  for (let b = 0; b < count; b++) {
    const start = Math.floor(r() * n)
    const f0 = 380 * Math.pow(4, r())
    const dur = 0.02 + r() * 0.06
    const amp = 0.15 + 0.85 * Math.pow(r(), 3)
    const len = Math.floor(dur * sr)
    const tau = dur / 4
    const pan = r()
    let phase = 0
    for (let j = 0; j < len && start + j < n; j++) {
      const t = j / sr
      const f = f0 * (1 + (0.6 * t) / dur)
      phase += (2 * Math.PI * f) / sr
      const atk = Math.min(1, t / 0.0015)
      out[start + j] += Math.sin(phase) * Math.exp(-t / tau) * atk * amp
      pans[start + j] = pan
    }
  }
  return out
}

function pineWind(n: number, sr: number, seed: number, gust: (t: number) => number): Float32Array {
  const r = rng(seed)
  const pink = new Pink()
  const brown = new Brown()
  const svf = new Svf(sr)
  const tmp = [0, 0]
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const g = gust(i / sr)
    if ((i & 63) === 0) svf.set(260 + 480 * g, 1.3)
    const w = r() * 2 - 1
    svf.run(0.6 * brown.next(w) + 0.4 * pink.next(r() * 2 - 1), tmp)
    out[i] = tmp[1] * (0.22 + 0.78 * Math.pow(g, 1.5))
  }
  return out
}

function pineNeedles(n: number, sr: number, seed: number, gust: (t: number) => number): Float32Array {
  // 松针的细碎沙沙声，只在风大时出来
  const r = rng(seed)
  const a = onePoleCoef(3200, sr)
  const b = onePoleCoef(9000, sr)
  let lp1 = 0
  let lp2 = 0
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1
    lp1 += a * (w - lp1)
    const hp = w - lp1
    lp2 += b * (hp - lp2)
    const g = gust(i / sr)
    out[i] = lp2 * g * g * g
  }
  return out
}

function lowRumble(n: number, sr: number, seed: number, fc: number, env: (t: number) => number): Float32Array {
  const r = rng(seed)
  const brown = new Brown()
  const a = onePoleCoef(fc, sr)
  let lp = 0
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    lp += a * (brown.next(r() * 2 - 1) - lp)
    out[i] = lp * env(i / sr)
  }
  return out
}

function fireHiss(n: number, sr: number, seed: number, flicker: (t: number) => number): Float32Array {
  const r = rng(seed)
  const svf = new Svf(sr)
  svf.set(3800, 0.7)
  const tmp = [0, 0]
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    svf.run(r() * 2 - 1, tmp)
    out[i] = tmp[1] * flicker(i / sr)
  }
  return out
}

/** 噼啪：成簇的极短噪声脉冲，偶尔一声大的 */
function crackles(n: number, sr: number, seed: number, perSecond: number, pans: Float32Array): Float32Array {
  const r = rng(seed)
  const out = new Float32Array(n)
  const count = Math.round((n / sr) * perSecond)
  const hpA = onePoleCoef(900, sr)
  for (let c = 0; c < count; c++) {
    const at = Math.floor(r() * n)
    const big = r() < 0.06
    const clicks = big ? 1 : 1 + Math.floor(r() * 4)
    const pan = r()
    for (let k = 0; k < clicks; k++) {
      const start = at + Math.floor(r() * 0.035 * sr)
      const len = Math.floor((big ? 0.006 + r() * 0.006 : 0.0006 + r() * 0.003) * sr)
      const amp = big ? 1.4 : 0.15 + 0.85 * Math.pow(r(), 2.5)
      let lp = 0
      for (let j = 0; j < len && start + j < n; j++) {
        const w = r() * 2 - 1
        lp += hpA * (w - lp)
        const src = big ? w * 0.6 + lp * 0.4 : w - lp
        out[start + j] += src * Math.exp((-5 * j) / len) * amp
        pans[start + j] = pan
      }
    }
  }
  return out
}

// ---------- 组装 ----------

function addPanned(left: Float32Array, right: Float32Array, a: Float32Array, pans: Float32Array, target: number) {
  const k = target / rms(a)
  for (let i = 0; i < left.length; i++) {
    const p = pans[i]
    left[i] += a[i] * k * Math.cos(p * Math.PI * 0.5) * 1.41
    right[i] += a[i] * k * Math.sin(p * Math.PI * 0.5) * 1.41
  }
}

function renderRaw(id: SynthId, n: number, sr: number): [Float32Array, Float32Array] {
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  if (id === 'noise') {
    mixIn(L, noiseBed(n, sr, 11), 1)
    mixIn(R, noiseBed(n, sr, 12), 1)
  } else if (id === 'stream') {
    mixIn(L, streamBed(n, sr, 21), 1)
    mixIn(R, streamBed(n, sr, 22), 1)
    mixIn(L, streamSplash(n, sr, 23), 0.32)
    mixIn(R, streamSplash(n, sr, 24), 0.32)
    const pans = new Float32Array(n).fill(0.5)
    addPanned(L, R, bubbles(n, sr, 25, 22, pans), pans, 0.42)
  } else if (id === 'pine') {
    const gustBase = slowWave([2, 5, 9, 23], [1, 0.55, 0.3, 0.12], 31)
    const gust = (t: number) => Math.max(0, Math.min(1, 0.5 + 0.55 * gustBase(t)))
    // 左右声道的风略错开，听起来是一片林子而不是一个点
    const gustR = (t: number) => gust((t + 0.35) % LOOP_SECONDS)
    mixIn(L, pineWind(n, sr, 32, gust), 1)
    mixIn(R, pineWind(n, sr, 33, gustR), 1)
    mixIn(L, pineNeedles(n, sr, 34, gust), 0.22)
    mixIn(R, pineNeedles(n, sr, 35, gustR), 0.22)
    const still = () => 1
    mixIn(L, lowRumble(n, sr, 36, 110, still), 0.3)
    mixIn(R, lowRumble(n, sr, 37, 110, still), 0.3)
  } else {
    const fl = slowWave([9, 17, 31, 53], [1, 0.7, 0.5, 0.35], 41)
    const flicker = (t: number) => 0.7 + 0.3 * fl(t)
    mixIn(L, lowRumble(n, sr, 42, 320, flicker), 1)
    mixIn(R, lowRumble(n, sr, 43, 320, flicker), 1)
    mixIn(L, fireHiss(n, sr, 44, flicker), 0.16)
    mixIn(R, fireHiss(n, sr, 45, flicker), 0.16)
    const pans = new Float32Array(n).fill(0.5)
    addPanned(L, R, crackles(n, sr, 46, 7, pans), pans, 0.55)
  }
  return [L, R]
}

/**
 * 渲染一段可无缝循环的立体声。
 * 多算 XFADE_SECONDS，把尾巴等功率交叉淡入到开头，循环点就听不出接缝。
 */
export function renderAmbience(id: SynthId, sampleRate: number): [Float32Array, Float32Array] {
  const n = Math.floor(LOOP_SECONDS * sampleRate)
  const f = Math.floor(XFADE_SECONDS * sampleRate)
  const raw = renderRaw(id, n + f, sampleRate)
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)]
  for (let c = 0; c < 2; c++) {
    const src = raw[c]
    const dst = out[c]
    for (let i = 0; i < n; i++) {
      if (i < f) {
        const x = (i / f) * Math.PI * 0.5
        dst[i] = src[i] * Math.sin(x) + src[n + i] * Math.cos(x)
      } else {
        dst[i] = src[i]
      }
    }
  }
  // 定响度，再软限幅，防止噼啪声削波
  const level = TARGET_RMS[id] / Math.max(rms(out[0]), rms(out[1]))
  for (let c = 0; c < 2; c++) {
    const d = out[c]
    for (let i = 0; i < n; i++) d[i] = Math.tanh(d[i] * level * 2.2) / 2.2
  }
  return out
}
