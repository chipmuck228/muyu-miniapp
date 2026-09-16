// 云存储 fileID → 本地临时路径。Skyline 下 <image> 不能直接吃 cloud://。

const cache: Record<string, string> = {}
const inflight: Record<string, Promise<string>> = {}

export const DAWN_FILE_ID =
  'cloud://cloud1-d5gcfyv8v980774aa.636c-cloud1-d5gcfyv8v980774aa-1485006126/assets/home/dawn.png'

export function resolveCloudFile(fileID: string): Promise<string> {
  if (!fileID) return Promise.reject(new Error('empty fileID'))
  if (cache[fileID]) return Promise.resolve(cache[fileID])
  if (inflight[fileID]) return inflight[fileID]
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
