// 拿不到录音时（本地模拟模式、没配文件、下载失败）在端上合成的木鱼声和钟钵声，用 WebAudio 播。
// 每种声音只算一次，存成 AudioBuffer，之后每敲一下只是新建一个播放节点。

const TWO_PI = Math.PI * 2

interface Mode {
  ratio: number
  amp: number
  /** 振幅降到 1/e 的时间（秒） */
  decay: number
}

function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return (s / 4294967296) * 2 - 1
  }
}

function normalize(out: Float32Array, peak: number) {
  let max = 0
  for (let i = 0; i < out.length; i++) max = Math.max(max, Math.abs(out[i]))
  if (!max) return
  const k = peak / max
  for (let i = 0; i < out.length; i++) out[i] *= k
}

/** 木鱼：空腔木头的一声“笃”。pitch 1 是默认音高；hardness 0..1 是起音那下的脆响，轻敲就小 */
export function renderKnock(rate: number, pitch: number, hardness: number): Float32Array {
  const f0 = 560 * pitch
  const modes: Mode[] = [
    { ratio: 1, amp: 1, decay: 0.09 / pitch },
    { ratio: 1.62, amp: 0.35, decay: 0.05 },
    { ratio: 2.71, amp: 0.18 * (0.4 + 0.6 * hardness), decay: 0.03 },
    { ratio: 4.1, amp: 0.08 * hardness, decay: 0.018 },
  ]
  const out = new Float32Array(Math.floor(rate * 0.5))
  const rnd = seeded(7)
  let lp = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    // 敲下去的一瞬音高略高，10ms 内落回来（按积分算相位，免得跳相）
    const warp = t + 0.04 * 0.01 * (1 - Math.exp(-t / 0.01))
    let v = 0
    for (const m of modes) v += m.amp * Math.exp(-t / m.decay) * Math.sin(TWO_PI * f0 * m.ratio * warp)
    // 槌头碰木头的那一下：低通过的短噪声
    lp += 0.35 * (rnd() - lp)
    v += 0.5 * hardness * lp * Math.exp(-t / 0.004)
    out[i] = v * Math.min(1, t / 0.0008)
  }
  normalize(out, 0.9)
  return out
}

/** 钟钵：几组不成整数倍的泛音，每组两条略错开的正弦，听得出慢慢的“嗡嗡”起伏 */
export function renderBell(rate: number): Float32Array {
  const f0 = 236
  const modes: (Mode & { beat: number })[] = [
    { ratio: 1, amp: 1, decay: 4.5, beat: 0.7 },
    { ratio: 2.74, amp: 0.55, decay: 2.6, beat: 1.3 },
    { ratio: 5.2, amp: 0.25, decay: 1.3, beat: 2.1 },
    { ratio: 8.5, amp: 0.12, decay: 0.6, beat: 3 },
  ]
  const seconds = 7
  const tail = 1.5
  const out = new Float32Array(Math.floor(rate * seconds))
  const rnd = seeded(11)
  let lp = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / rate
    let v = 0
    for (const m of modes) {
      const f = f0 * m.ratio
      v += 0.5 * m.amp * Math.exp(-t / m.decay) * (Math.sin(TWO_PI * f * t) + Math.sin(TWO_PI * (f + m.beat) * t))
    }
    lp += 0.2 * (rnd() - lp)
    v += 0.15 * lp * Math.exp(-t / 0.01)
    // 起音 3ms；最后 1.5s 收到零，不留断口
    const end = Math.min(1, (seconds - t) / tail)
    out[i] = v * Math.min(1, t / 0.003) * end * end
  }
  normalize(out, 0.8)
  return out
}

let audio: any = null
let unsupported = false
const buffers: Record<string, any> = {}

function audioCtx(): any {
  if (audio || unsupported) return audio
  const anyWx: any = wx
  if (typeof anyWx.createWebAudioContext !== 'function') {
    unsupported = true
    return null
  }
  try {
    audio = anyWx.createWebAudioContext()
  } catch (e) {
    unsupported = true
    console.warn('synth audio unavailable', e)
  }
  return audio
}

function bufferOf(key: string, render: (rate: number) => Float32Array): any {
  if (buffers[key]) return buffers[key]
  const a = audioCtx()
  if (!a) return null
  try {
    const rate = a.sampleRate || 44100
    const data = render(rate)
    const b = a.createBuffer(1, data.length, rate)
    b.getChannelData(0).set(data)
    buffers[key] = b
    return b
  } catch (e) {
    console.warn('synth render failed', key, e)
    return null
  }
}

function play(buffer: any, volume: number, speed = 1) {
  const a = audio
  if (!a || !buffer) return
  try {
    if (a.state === 'suspended' && typeof a.resume === 'function') a.resume()
    const src = a.createBufferSource()
    src.buffer = buffer
    if (speed !== 1 && src.playbackRate) src.playbackRate.value = speed
    const gain = a.createGain()
    gain.gain.value = volume
    src.connect(gain)
    gain.connect(a.destination)
    src.start(0)
  } catch (e) {
    console.warn('synth play failed', e)
  }
}

function knockBuffer(pitch: number, hardness: number): any {
  return bufferOf('knock:' + pitch + ':' + hardness, (rate) => renderKnock(rate, pitch, hardness))
}

/** 先算好，第一下就能响 */
export function prepareSynthKnock(pitch: number, hardness: number) {
  knockBuffer(pitch, hardness)
}

/** speed：每一下微微变一点快慢（音高跟着动），连敲时不像同一个采样在复读 */
export function playSynthKnock(pitch: number, hardness: number, volume: number, speed = 1) {
  play(knockBuffer(pitch, hardness), volume, speed)
}

export function prepareSynthBell() {
  bufferOf('bell', renderBell)
}

export function playSynthBell(volume: number) {
  play(bufferOf('bell', renderBell), volume)
}
