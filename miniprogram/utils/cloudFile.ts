// 云存储 fileID → 本地临时路径。Skyline 下 <image> 不能直接吃 cloud://。

import { mockEnabled } from './devMock'

const cache: Record<string, string> = {}
const inflight: Record<string, Promise<string>> = {}

export const DAWN_FILE_ID =
  'cloud://cloud1-d5gcfyv8v980774aa.636c-cloud1-d5gcfyv8v980774aa-1485006126/assets/home/dawn.png'

export function resolveCloudFile(fileID: string): Promise<string> {
  if (!fileID) return Promise.reject(new Error('empty fileID'))
  // 本地模拟模式没有云存储权限：直接失败，不白等下载超时
  if (mockEnabled()) return Promise.reject(new Error('mock: no cloud file'))
  if (cache[fileID]) return Promise.resolve(cache[fileID])
  if (fileID in inflight) return inflight[fileID]
  inflight[fileID] = wx.cloud
    .downloadFile({ fileID })
    .then((r) => {
      const path = r && r.tempFilePath
      if (!path) throw new Error('download empty')
      cache[fileID] = path
      delete inflight[fileID]
      return path
    })
    .catch((e) => {
      delete inflight[fileID]
      throw e
    })
  return inflight[fileID]
}
