// 敲击音效：运行时合成一段「笃」的木鱼短音写入用户目录，再通过 InnerAudioContext 播放
// 这样无需携带任何音频资源，主包更小

const FILE_NAME = '/knock.wav'
const SAMPLE_RATE = 22050
const DURATION = 0.22 // 秒

let audioCtx: any = null
let ready = false
let generating = false

function synthWav(): ArrayBuffer {
  const n = Math.floor(SAMPLE_RATE * DURATION)
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE
    // 主频：木质高频叩击音 + 腔体共鸣 + 短促噪声，指数衰减
    let s =
      0.95 * Math.exp(-t * 46) * Math.sin(2 * Math.PI * 1180 * t) +
      0.55 * Math.exp(-t * 26) * Math.sin(2 * Math.PI * 470 * t + 0.6) +
      0.35 * Math.exp(-t * 30) * Math.sin(2 * Math.PI * 233 * t)
    if (t < 0.008) {
      s += (Math.random() * 2 - 1) * 0.5 * Math.exp(-t * 900)
    }
    data[i] = s
  }
  // 限幅
  let peak = 0.001
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[i]))
  const norm = peak > 0.9 ? 0.9 / peak : 1

  const bytesPerSample = 2
  const dataSize = n * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeStr = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, data[i] * norm))
    view.setInt16(44 + i * 2, Math.round(v * 32767), true)
  }
  return buffer
}

function initAudio(path: string) {
  if (audioCtx) return
  try {
    audioCtx = wx.createInnerAudioContext()
    audioCtx.src = path
    audioCtx.volume = 1
    audioCtx.obeyMuteSwitch = false
  } catch {
    audioCtx = null
  }
}

/** 应用启动时预生成音效文件（幂等） */
export function ensureKnock() {
  if (ready || generating) return
  if (!wx.getFileSystemManager) return
  generating = true
  const fs = wx.getFileSystemManager()
  const anyWx: any = wx
  const path = anyWx.env.USER_DATA_PATH + FILE_NAME
  try {
    fs.accessSync(path)
    ready = true
    initAudio(path)
    generating = false
  } catch {
    try {
      const ab = synthWav()
      fs.writeFileSync(path, ab)
      ready = true
      initAudio(path)
    } catch {
      // 合成失败时静默降级（无音效）
    }
    generating = false
  }
}

/** 播放敲击音（on 为当前用户音效开关） */
export function playKnock(on: boolean) {
  if (!on) return
  ensureKnock()
  if (!audioCtx) return
  try {
    audioCtx.stop()
    audioCtx.play()
  } catch {
    // ignore
  }
}

/** 震动（on 为震动开关），type 兜底 */
export function vibrate(on: boolean) {
  if (!on) return
  const anyWx: any = wx
  try {
    anyWx.vibrateShort && anyWx.vibrateShort({ type: 'heavy' })
  } catch {
    try {
      anyWx.vibrateShort && anyWx.vibrateShort({ type: 'medium' })
    } catch {
      // ignore
    }
  }
}
