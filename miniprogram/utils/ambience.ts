// 香案氛围循环。只在香案页播放，离开即停。
// 雨声 / 钟钵走云端文件。白噪 / 溪流 / 松风 / 炉火在端上生成。

import { AmbienceId, AUDIO_FILES, isPremiumAmbience } from './audioCatalog'
import { resolveCloudFile } from './cloudFile'
import { applyAudioOption } from './knock'

const FILE_VOLUME: Record<'rain' | 'bowl', number> = {
  rain: 0.04,
  bowl: 0.05,
}

let ctx: any = null
let wanted: AmbienceId = 'off'
let playingId: AmbienceId = 'off'
let proc: { stop: () => void } | null = null

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

function noiseBuffer(audio: any, seconds: number): any {
  const rate = audio.sampleRate || 44100
  const length = Math.max(1, Math.floor(rate * seconds))
  const buffer = audio.createBuffer(1, length, rate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

function connectBed(audio: any, src: any, gain: any, id: AmbienceId) {
  let filter: any = null
  try {
    filter = audio.createBiquadFilter()
  } catch {
    filter = null
  }
  if (id === 'stream' && filter) {
    filter.type = 'bandpass'
    filter.frequency.value = 880
    filter.Q.value = 0.7
    gain.gain.value = 0.05
    src.connect(filter)
    filter.connect(gain)
    return
  }
  if (id === 'pine' && filter) {
    filter.type = 'lowpass'
    filter.frequency.value = 340
    gain.gain.value = 0.04
    src.connect(filter)
    filter.connect(gain)
    return
  }
  if (id === 'fire' && filter) {
    filter.type = 'highpass'
    filter.frequency.value = 1600
    gain.gain.value = 0.014
    src.connect(filter)
    filter.connect(gain)
    return
  }
  gain.gain.value = 0.03
  src.connect(gain)
}

function startProcedural(id: AmbienceId): { stop: () => void } | null {
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
    src = audio.createBufferSource()
    src.buffer = noiseBuffer(audio, 3)
    src.loop = true
    gain = audio.createGain()
    connectBed(audio, src, gain, id)
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

  let wobble: any = 0
  if (id === 'stream' || id === 'pine') {
    const base = gain.gain.value || 0.04
    const span = id === 'pine' ? 0.45 : 0.22
    wobble = setInterval(() => {
      try {
        gain.gain.value = base * (1 - span + Math.random() * span * 2)
      } catch {
        // ignore
      }
    }, id === 'pine' ? 900 : 280)
  }

  let alive = true
  let burst: any = 0
  const pop = () => {
    burst = 0
    if (!alive) return
    try {
      const rate = audio.sampleRate || 44100
      const n = Math.floor(rate * 0.04)
      const buffer = audio.createBuffer(1, n, rate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < n; i++) {
        const env = 1 - i / n
        data[i] = (Math.random() * 2 - 1) * env * env
      }
      const burstSrc = audio.createBufferSource()
      const burstGain = audio.createGain()
      burstSrc.buffer = buffer
      burstGain.gain.value = 0.1
      burstSrc.connect(burstGain)
      burstGain.connect(audio.destination)
      burstSrc.start(0)
    } catch {
      // ignore
    }
    if (!alive) return
    burst = setTimeout(pop, 320 + Math.random() * 860)
  }
  if (id === 'fire') burst = setTimeout(pop, 420)

  return {
    stop() {
      alive = false
      if (wobble) clearInterval(wobble)
      if (burst) clearTimeout(burst)
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

export function stopAmbience() {
  wanted = 'off'
  destroyCtx()
  stopProc()
  playingId = 'off'
}

export function startAmbience(id: AmbienceId) {
  applyAudioOption()
  wanted = id
  if (!id || id === 'off') {
    stopAmbience()
    return
  }
  if (isPremiumAmbience(id)) {
    if (playingId === id && proc) return
    destroyCtx()
    stopProc()
    proc = startProcedural(id)
    playingId = proc ? id : 'off'
    if (!proc) console.warn('ambience synth unavailable', id)
    return
  }
  stopProc()
  const fileID = AUDIO_FILES[id as 'rain' | 'bowl']
  if (!fileID) {
    destroyCtx()
    playingId = 'off'
    return
  }
  if (playingId === id && ctx) {
    try {
      ctx.volume = FILE_VOLUME[id as 'rain' | 'bowl']
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
      ctx.volume = FILE_VOLUME[id as 'rain' | 'bowl']
      ctx.obeyMuteSwitch = false
      ctx.play()
      playingId = id
    })
    .catch((e) => {
      console.warn('ambience load failed', e)
    })
}
