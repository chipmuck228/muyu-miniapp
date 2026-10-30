// 香案氛围循环。只在香案页播放，离开即停。
// 有录音走录音（云端文件），没配录音或下载失败（含本地模拟模式）就在端上合成。

import { AmbienceId, AUDIO_FILES } from './audioCatalog'
import { renderAmbience, SynthId } from './ambienceSynth'
import { resolveCloudFile } from './cloudFile'
import { applyAudioOption } from './knock'

// 录音的播放音量。付费氛围的录音上传后按实际响度再调
const FILE_VOLUME: Record<Exclude<AmbienceId, 'off'>, number> = {
  rain: 0.04,
  bowl: 0.05,
  noise: 0.05,
  stream: 0.05,
  pine: 0.05,
  fire: 0.05,
}

let ctx: any = null
let wanted: AmbienceId = 'off'
let playingId: AmbienceId = 'off'
interface Proc {
  stop: () => void
  /** 0..1，淡出用 */
  setLevel: (k: number) => void
}

let proc: Proc | null = null
/** 每次开 / 停都换一个号，正在进行的淡出看到号变了就收手 */
let fadeSeq = 0

function destroyCtx() {
  if (!ctx) return
  try {
    ctx.stop()
  } catch {
    // ignore
  }
  try {
    ctx.destroy()
  } catch {
    // ignore
  }
  ctx = null
  if (!proc) playingId = 'off'
}

function stopProc() {
  if (!proc) return
  try {
    proc.stop()
  } catch {
    // ignore
  }
  proc = null
}

// 合成结果按 id 缓存，切回同一个氛围不用重算。只留最近一个，一段约 16s 立体声占几 MB。
let baked: { id: SynthId; rate: number; data: [Float32Array, Float32Array] } | null = null

function bake(id: SynthId, rate: number): [Float32Array, Float32Array] {
  if (baked && baked.id === id && baked.rate === rate) return baked.data
  const data = renderAmbience(id, rate)
  baked = { id, rate, data }
  return data
}

const FADE_IN_MS = 1500

function startProcedural(id: AmbienceId): Proc | null {
  const anyWx: any = wx
  if (typeof anyWx.createWebAudioContext !== 'function') return null
  let audio: any
  try {
    audio = anyWx.createWebAudioContext()
  } catch {
    return null
  }
  let src: any
  let gain: any
  try {
    const rate = audio.sampleRate || 44100
    const data = bake(id as SynthId, rate)
    const buffer = audio.createBuffer(2, data[0].length, rate)
    buffer.getChannelData(0).set(data[0])
    buffer.getChannelData(1).set(data[1])
    src = audio.createBufferSource()
    src.buffer = buffer
    src.loop = true
    gain = audio.createGain()
    gain.gain.value = 0
    src.connect(gain)
    gain.connect(audio.destination)
    src.start(0)
  } catch (e) {
    try {
      audio.close()
    } catch {
      // ignore
    }
    console.warn('ambience synth failed', e)
    return null
  }

  // 淡入，避免一开就是满音量的一声
  const t0 = Date.now()
  let fade: any = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / FADE_IN_MS)
    try {
      gain.gain.value = k * k
    } catch {
      // ignore
    }
    if (k >= 1) {
      clearInterval(fade)
      fade = 0
    }
  }, 50)

  return {
    setLevel(k: number) {
      if (fade) {
        clearInterval(fade)
        fade = 0
      }
      try {
        gain.gain.value = k
      } catch {
        // ignore
      }
    },
    stop() {
      if (fade) clearInterval(fade)
      try {
        src.stop()
      } catch {
        // ignore
      }
      try {
        audio.close()
      } catch {
        // ignore
      }
    },
  }
}

function playSynth(id: AmbienceId) {
  if (playingId === id && proc) return
  destroyCtx()
  stopProc()
  proc = startProcedural(id)
  playingId = proc ? id : 'off'
  if (!proc) console.warn('ambience synth unavailable', id)
}

export function stopAmbience() {
  fadeSeq += 1
  wanted = 'off'
  destroyCtx()
  stopProc()
  playingId = 'off'
}

export function startAmbience(id: AmbienceId) {
  fadeSeq += 1
  applyAudioOption()
  wanted = id
  if (!id || id === 'off') {
    stopAmbience()
    return
  }
  const fileID = AUDIO_FILES[id]
  if (!fileID) {
    playSynth(id)
    return
  }
  stopProc()
  if (playingId === id && ctx) {
    try {
      ctx.volume = FILE_VOLUME[id]
      ctx.play()
    } catch {
      // ignore
    }
    return
  }
  destroyCtx()
  resolveCloudFile(fileID)
    .then((path) => {
      if (wanted !== id) return
      const anyWx: any = wx
      try {
        ctx = anyWx.createInnerAudioContext({ useWebAudioImplement: true })
      } catch {
        ctx = wx.createInnerAudioContext()
      }
      ctx.src = path
      ctx.loop = true
      ctx.volume = FILE_VOLUME[id]
      ctx.obeyMuteSwitch = false
      ctx.play()
      playingId = id
    })
    .catch((e) => {
      console.warn('ambience load failed, using synth', id, e)
      // 录音拿不到时退回合成，别让人听到一片安静
      if (wanted === id) playSynth(id)
    })
}

/** 定课收尾：当前氛围在 ms 内慢慢静下去，然后停掉。中途换了氛围就不管了 */
export function fadeOutAmbience(ms: number): Promise<void> {
  const seq = ++fadeSeq
  const id = playingId
  if (id === 'off' || (!ctx && !proc)) {
    stopAmbience()
    return Promise.resolve()
  }
  const base = ctx ? FILE_VOLUME[id] : 1
  const t0 = Date.now()
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (seq !== fadeSeq) {
        clearInterval(timer)
        resolve()
        return
      }
      const k = Math.max(0, 1 - (Date.now() - t0) / ms)
      try {
        if (ctx) ctx.volume = base * k * k
        if (proc) proc.setLevel(k * k)
      } catch {
        // ignore
      }
      if (k <= 0) {
        clearInterval(timer)
        stopAmbience()
        resolve()
      }
    }, 50)
  })
}
