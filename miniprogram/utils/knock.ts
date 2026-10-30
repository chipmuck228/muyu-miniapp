// 敲击音效：云端短 MP3。空 fileID 时静默。iOS 静音拨片靠 setInnerAudioOption。

import { AUDIO_FILES } from './audioCatalog'
import { resolveCloudFile } from './cloudFile'

const POOL = 2

let optionSet = false

export type KnockTimbre = 'default' | 'low' | 'soft'

// 静心包定课的音色。没有专门的录音时，用默认敲击声放慢 / 放轻顶上
const TIMBRES: Record<KnockTimbre, { file: 'knock' | 'knockLow' | 'knockSoft'; rate: number; volume: number }> = {
  default: { file: 'knock', rate: 1, volume: 1 },
  low: { file: 'knockLow', rate: 0.8, volume: 1 },
  soft: { file: 'knockSoft', rate: 1, volume: 0.45 },
}

interface Voice {
  path: string
  loading: boolean
  pool: any[]
  cursor: number
}

// 按音频文件分池：几种音色共用 knock 时只取一次文件
const voices: Record<string, Voice> = {}

function voiceOf(key: string): Voice {
  if (!voices[key]) voices[key] = { path: '', loading: false, pool: [], cursor: 0 }
  return voices[key]
}

function fileKeyOf(timbre: KnockTimbre): 'knock' | 'knockLow' | 'knockSoft' {
  const key = TIMBRES[timbre].file
  return AUDIO_FILES[key] ? key : 'knock'
}

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

export function ensureKnock(timbre: KnockTimbre = 'default') {
  applyAudioOption()
  const key = fileKeyOf(timbre)
  const fileID = AUDIO_FILES[key]
  const v = voiceOf(key)
  if (!fileID || v.loading || v.path) return
  v.loading = true
  resolveCloudFile(fileID)
    .then((path) => {
      v.path = path
      for (let i = 0; i < POOL; i++) v.pool.push(makeCtx(path))
    })
    .catch((e) => {
      console.warn('knock load failed', key, e)
    })
    .then(() => {
      v.loading = false
    })
}

export function playKnock(on: boolean, timbre: KnockTimbre = 'default') {
  if (!on) return
  applyAudioOption()
  const key = fileKeyOf(timbre)
  const v = voiceOf(key)
  if (!v.path) {
    ensureKnock(timbre)
    return
  }
  const ctx = v.pool[v.cursor]
  v.cursor = (v.cursor + 1) % v.pool.length
  if (!ctx) return
  // 有专门录音就原样播；借用默认敲击声时才放慢 / 放轻
  const t = TIMBRES[timbre]
  const borrowed = key !== t.file
  try {
    ctx.volume = borrowed ? t.volume : 1
    ctx.playbackRate = borrowed ? t.rate : 1
  } catch {
    // 不支持变速的机型就按原声播
  }
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

// 定课结束的一声钟钵：和氛围里的钟钵同一个文件，单独一个音频实例，不循环
let bellCtx: any = null
let bellLoading = false

/** 开始定课时先取好文件，结束时才能立刻响 */
export function ensureBell() {
  const fileID = AUDIO_FILES.bowl
  if (!fileID || bellCtx || bellLoading) return
  bellLoading = true
  resolveCloudFile(fileID)
    .then((path) => {
      bellCtx = makeCtx(path)
    })
    .catch((e) => {
      console.warn('bell load failed', e)
    })
    .then(() => {
      bellLoading = false
    })
}

export function playBell(on: boolean) {
  if (!on) return
  applyAudioOption()
  if (!bellCtx) {
    ensureBell()
    return
  }
  try {
    bellCtx.volume = 0.6
    if (typeof bellCtx.seek === 'function') bellCtx.seek(0)
    bellCtx.play()
  } catch {
    // ignore
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
