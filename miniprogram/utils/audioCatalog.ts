// 云端音频清单。上传 mp3 后填 cloud:// fileID，不打进主包。空则静默无声。
// 白噪 / 溪流 / 松风 / 炉火不走文件，由香案页用 WebAudio 生成，且需已开启。

export type AmbienceId = 'off' | 'rain' | 'bowl' | 'noise' | 'stream' | 'pine' | 'fire'

export const AUDIO_FILES: Record<'knock' | 'rain' | 'bowl', string> = {
  knock:
    'cloud://cloud1-d5gcfyv8v980774aa.636c-cloud1-d5gcfyv8v980774aa-1485006126/assets/audio/virtual_vibes-minimal-ui-pop-383735.mp3',
  rain:
    'cloud://cloud1-d5gcfyv8v980774aa.636c-cloud1-d5gcfyv8v980774aa-1485006126/assets/audio/rain.mp3',
  bowl:
    'cloud://cloud1-d5gcfyv8v980774aa.636c-cloud1-d5gcfyv8v980774aa-1485006126/assets/audio/soundreality-bell-fx-410608.mp3',
}

export const AMBIENCE_OPTIONS: { id: AmbienceId; name: string; premium?: boolean }[] = [
  { id: 'off', name: '无' },
  { id: 'rain', name: '雨声' },
  { id: 'bowl', name: '钟钵' },
  { id: 'noise', name: '白噪', premium: true },
  { id: 'stream', name: '溪流', premium: true },
  { id: 'pine', name: '松风', premium: true },
  { id: 'fire', name: '炉火', premium: true },
]

const PREMIUM_AMBIENCE: Record<string, 1> = { noise: 1, stream: 1, pine: 1, fire: 1 }

export function isPremiumAmbience(id: string): boolean {
  return !!PREMIUM_AMBIENCE[id]
}

export function parseAmbience(v: any): AmbienceId {
  if (v === 'rain' || v === 'bowl' || v === 'noise' || v === 'stream' || v === 'pine' || v === 'fire') return v
  return 'off'
}
