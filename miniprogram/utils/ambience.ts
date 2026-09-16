// 香案氛围循环。只在香案页播放，离开即停。空 fileID 时静默。

import { AmbienceId, AUDIO_FILES } from './audioCatalog'
import { resolveCloudFile } from './cloudFile'
import { applyAudioOption } from './knock'

const VOLUME: Record<AmbienceId, number> = {
  off: 0,
  rain: 0.04,
  noise: 0.04,
  bowl: 0.05,
}

let ctx: any = null
let wanted: AmbienceId = 'off'
let playingId: AmbienceId = 'off'

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
  playingId = 'off'
}

export function stopAmbience() {
  wanted = 'off'
  destroyCtx()
}

export function startAmbience(id: AmbienceId) {
  applyAudioOption()
  wanted = id
  if (!id || id === 'off') {
    destroyCtx()
    return
  }
  const fileID = AUDIO_FILES[id]
  if (!fileID) {
    destroyCtx()
    return
  }
  if (playingId === id && ctx) {
    try {
      ctx.volume = VOLUME[id]
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
      ctx.volume = VOLUME[id]
      ctx.obeyMuteSwitch = false
      ctx.play()
      playingId = id
    })
    .catch((e) => {
      console.warn('ambience load failed', e)
    })
}
