// 敲击音效：云端短 MP3。没配文件、下载失败（含本地模拟模式）时改用 knockSynth 合成的声音。
// iOS 静音拨片靠 setInnerAudioOption。

import { AUDIO_FILES } from './audioCatalog'
import { resolveCloudFile } from './cloudFile'
import { prepareSynthBell, prepareSynthKnock, playSynthBell, playSynthKnock } from './knockSynth'

const POOL = 2

let optionSet = false

export type KnockTimbre = 'default' | 'low' | 'soft'

// 静心包定课的音色。没有专门的录音时，用默认敲击声放慢 / 放轻顶上。
// hardness 只给合成声用：轻敲时起音那下的脆响小一些
const TIMBRES: Record<
  KnockTimbre,
  { file: 'knock' | 'knockLow' | 'knockSoft'; rate: number; volume: number; hardness: number }
> = {
  default: { file: 'knock', rate: 1, volume: 1, hardness: 1 },
  low: { file: 'knockLow', rate: 0.8, volume: 1, hardness: 0.8 },
  soft: { file: 'knockSoft', rate: 1, volume: 0.45, hardness: 0.3 },
}

interface Voice {
  path: string
  loading: boolean
  /** 没配文件或下载失败：先用合成声，下次 ensureKnock 再试着下载 */
  failed: boolean
  pool: any[]
  cursor: number
}

// 按音频文件分池：几种音色共用 knock 时只取一次文件
const voices: Record<string, Voice> = {}

function voiceOf(key: string): Voice {
  if (!voices[key]) voices[key] = { path: '', loading: false, failed: false, pool: [], cursor: 0 }
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
  const t = TIMBRES[timbre]
  if (!fileID) {
    v.failed = true
    prepareSynthKnock(t.rate, t.hardness)
    return
  }
  if (v.loading || v.path) return
  v.loading = true
  resolveCloudFile(fileID)
    .then((path) => {
      v.path = path
      v.failed = false
      for (let i = 0; i < POOL; i++) v.pool.push(makeCtx(path))
    })
    .catch((e) => {
      v.failed = true
      prepareSynthKnock(t.rate, t.hardness)
      console.warn('knock load failed, using synth', key, e)
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
  const t = TIMBRES[timbre]
  if (!v.path) {
    // 下载失败就一直用合成声，不在每一下都重新下载；还在下载的头几下照旧不响
    if (v.failed) playSynthKnock(t.rate, t.hardness, t.volume)
    else ensureKnock(timbre)
    return
  }
  const ctx = v.pool[v.cursor]
  v.cursor = (v.cursor + 1) % v.pool.length
  if (!ctx) return
  // 有专门录音就原样播；借用默认敲击声时才放慢 / 放轻
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

// 定课结束的一声钟钵：和氛围里的钟钵同一个文件，单独一个音频实例，不循环。拿不到文件就用合成的
const BELL_VOLUME = 0.6
let bellCtx: any = null
let bellLoading = false
let bellFailed = false

/** 开始定课时先取好文件，结束时才能立刻响 */
export function ensureBell() {
  const fileID = AUDIO_FILES.bowl
  if (!fileID) {
    bellFailed = true
    prepareSynthBell()
    return
  }
  if (bellCtx || bellLoading) return
  bellLoading = true
  resolveCloudFile(fileID)
    .then((path) => {
      bellCtx = makeCtx(path)
      bellFailed = false
    })
    .catch((e) => {
      bellFailed = true
      prepareSynthBell()
      console.warn('bell load failed, using synth', e)
    })
    .then(() => {
      bellLoading = false
    })
}

export function playBell(on: boolean) {
  if (!on) return
  applyAudioOption()
  if (!bellCtx) {
    if (bellFailed) playSynthBell(BELL_VOLUME)
    else ensureBell()
    return
  }
  try {
    bellCtx.volume = BELL_VOLUME
    if (typeof bellCtx.seek === 'function') bellCtx.seek(0)
    bellCtx.play()
  } catch {
    // ignore
  }
}

/** 亲手敲用重震；自动敲每 0.8 秒一下，用轻震，免得手里一直嗡嗡响 */
export function vibrate(on: boolean, type: 'heavy' | 'medium' | 'light' = 'heavy') {
  if (!on) return
  const anyWx: any = wx
  try {
    anyWx.vibrateShort && anyWx.vibrateShort({ type })
  } catch {
    try {
      anyWx.vibrateShort && anyWx.vibrateShort({ type: 'medium' })
    } catch {
      // ignore
    }
  }
}

/** 心愿圆满、定课收尾这类大时刻：长震一下 */
export function vibrateLong(on: boolean) {
  if (!on) return
  try {
    wx.vibrateLong({})
  } catch {
    vibrate(on)
  }
}
