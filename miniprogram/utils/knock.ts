// 敲击音效：云端短 MP3。空 fileID 时静默。iOS 静音拨片靠 setInnerAudioOption。

import { AUDIO_FILES } from './audioCatalog'
import { resolveCloudFile } from './cloudFile'

const POOL = 2

let optionSet = false
let knockPath = ''
let loading = false
const pool: any[] = []
let cursor = 0

export function applyAudioOption() {
  if (optionSet) return
  optionSet = true
  try {
    wx.setInnerAudioOption({
      obeyMuteSwitch: false,
      speakerOn: true,
      mixWithOther: true,
    })
  } catch {
    optionSet = false
  }
}

function makeCtx(src: string) {
  const anyWx: any = wx
  let ctx: any = null
  try {
    ctx = anyWx.createInnerAudioContext({ useWebAudioImplement: true })
  } catch {
    ctx = wx.createInnerAudioContext()
  }
  ctx.src = src
  ctx.volume = 1
  ctx.obeyMuteSwitch = false
  return ctx
}

function fillPool(path: string) {
  knockPath = path
  if (pool.length) {
    pool.forEach((c) => {
      try {
        c.src = path
      } catch {
        // ignore
      }
    })
    return
  }
  for (let i = 0; i < POOL; i++) pool.push(makeCtx(path))
}

export function ensureKnock() {
  applyAudioOption()
  const fileID = AUDIO_FILES.knock
  if (!fileID || loading || knockPath) return
  loading = true
  resolveCloudFile(fileID)
    .then((path) => {
      fillPool(path)
    })
    .catch((e) => {
      console.warn('knock load failed', e)
    })
    .then(() => {
      loading = false
    })
}

export function playKnock(on: boolean) {
  if (!on) return
  applyAudioOption()
  if (!knockPath) {
    ensureKnock()
    return
  }
  const ctx = pool[cursor]
  cursor = (cursor + 1) % pool.length
  if (!ctx) return
  try {
    if (typeof ctx.seek === 'function') ctx.seek(0)
    ctx.play()
  } catch {
    try {
      ctx.stop()
      ctx.play()
    } catch {
      // ignore
    }
  }
}

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
