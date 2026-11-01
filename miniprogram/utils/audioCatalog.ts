// 云端音频清单。上传 mp3 后填 cloud:// fileID，不打进主包。
// 白噪 / 溪流 / 松风 / 炉火需已开启。所有氛围都是填了录音就播录音，
// 留空或下载失败就用 utils/ambienceSynth.ts 现场合成。

export type AmbienceId = 'off' | 'rain' | 'bowl' | 'noise' | 'stream' | 'pine' | 'fire'

export const AUDIO_FILES: Record<
  'knock' | 'knockLow' | 'knockSoft' | 'rain' | 'bowl' | 'noise' | 'stream' | 'pine' | 'fire',
  string
> = {
  knock:
    'cloud://cloud1-d5gcfyv8v980774aa.636c-cloud1-d5gcfyv8v980774aa-1485006126/assets/audio/virtual_vibes-minimal-ui-pop-383735.mp3',
  // 静心包定课的木鱼音色：低沉（松间慢叩）/ 轻柔（夜里收心）。留空就用 knock 放慢 / 放轻顶上
  knockLow: '',
  knockSoft: '',
  rain:
    'cloud://cloud1-d5gcfyv8v980774aa.636c-cloud1-d5gcfyv8v980774aa-1485006126/assets/audio/rain.mp3',
  bowl:
    'cloud://cloud1-d5gcfyv8v980774aa.636c-cloud1-d5gcfyv8v980774aa-1485006126/assets/audio/soundreality-bell-fx-410608.mp3',
  // 付费氛围的录音，上传到 assets/audio/ 后填上；留空走合成
  noise: '',
  stream: '',
  pine: '',
  fire: '',
}

export const AMBIENCE_OPTIONS: { id: AmbienceId; name: string; desc: string; premium?: boolean }[] = [
  { id: 'off', name: '无', desc: '只有木鱼声' },
  { id: 'rain', name: '雨声', desc: '窗外的雨' },
  { id: 'bowl', name: '钟钵', desc: '隔一会儿一声钵响' },
  { id: 'noise', name: '白噪', desc: '均匀的沙沙声，盖住杂音', premium: true },
  { id: 'stream', name: '溪流', desc: '山涧流水', premium: true },
  { id: 'pine', name: '松风', desc: '风过松林', premium: true },
  { id: 'fire', name: '炉火', desc: '炉里柴火轻响', premium: true },
]

const PREMIUM_AMBIENCE: Record<string, 1> = { noise: 1, stream: 1, pine: 1, fire: 1 }

export function isPremiumAmbience(id: string): boolean {
  return !!PREMIUM_AMBIENCE[id]
}

export function parseAmbience(v: any): AmbienceId {
  if (v === 'rain' || v === 'bowl' || v === 'noise' || v === 'stream' || v === 'pine' || v === 'fire') return v
  return 'off'
}
