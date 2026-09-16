// 云端音频清单。上传 mp3 后填 cloud:// fileID，不打进主包。空则静默无声。

export type AmbienceId = 'off' | 'rain' | 'noise' | 'bowl'

export const AUDIO_FILES: Record<'knock' | 'rain' | 'noise' | 'bowl', string> = {
  knock:
    'cloud://cloud1-d5gcfyv8v980774aa.636c-cloud1-d5gcfyv8v980774aa-1485006126/assets/audio/virtual_vibes-minimal-ui-pop-383735.mp3',
  rain:
    'cloud://cloud1-d5gcfyv8v980774aa.636c-cloud1-d5gcfyv8v980774aa-1485006126/assets/audio/rain.mp3',
  noise: '',
  bowl:
    'cloud://cloud1-d5gcfyv8v980774aa.636c-cloud1-d5gcfyv8v980774aa-1485006126/assets/audio/soundreality-bell-fx-410608.mp3',
}

export const AMBIENCE_OPTIONS: { id: AmbienceId; name: string }[] = [
  { id: 'off', name: '无' },
  { id: 'rain', name: '雨声' },
  { id: 'noise', name: '白噪' },
  { id: 'bowl', name: '钟钵' },
]

export function parseAmbience(v: any): AmbienceId {
  if (v === 'rain' || v === 'noise' || v === 'bowl') return v
  return 'off'
}
