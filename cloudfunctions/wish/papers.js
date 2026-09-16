// 图库只在云端：id + 档位 + 云存储 fileId。上传 thumb/origin 后填 fileId，不用发版小程序。
// 档位：素 1–99 / 雅 100–499 / 精 500–999 / 珍 1000–4999 / 极 5000+

const TIERS = [
  { id: 'su', min: 1, max: 99, papers: ['su-1', 'su-2'] },
  { id: 'ya', min: 100, max: 499, papers: ['ya-1', 'ya-2'] },
  { id: 'jing', min: 500, max: 999, papers: ['jing-1', 'jing-2'] },
  { id: 'zhen', min: 1000, max: 4999, papers: ['zhen-1', 'zhen-2'] },
  { id: 'ji', min: 5000, max: 1e9, papers: ['ji-1', 'ji-2'] },
]

const FILES = {
  'su-1': { thumbFileId: '', originFileId: '' },
  'su-2': { thumbFileId: '', originFileId: '' },
  'ya-1': { thumbFileId: '', originFileId: '' },
  'ya-2': { thumbFileId: '', originFileId: '' },
  'jing-1': { thumbFileId: '', originFileId: '' },
  'jing-2': { thumbFileId: '', originFileId: '' },
  'zhen-1': { thumbFileId: '', originFileId: '' },
  'zhen-2': { thumbFileId: '', originFileId: '' },
  'ji-1': { thumbFileId: '', originFileId: '' },
  'ji-2': { thumbFileId: '', originFileId: '' },
}

function tierOfGoal(goal) {
  const n = Number(goal) || 0
  for (let i = 0; i < TIERS.length; i++) {
    if (n >= TIERS[i].min && n <= TIERS[i].max) return TIERS[i]
  }
  return TIERS[TIERS.length - 1]
}

function pickPaper(goal) {
  const tier = tierOfGoal(goal)
  const list = tier.papers
  const id = list[Math.floor(Math.random() * list.length)]
  return { paperId: id, paperTier: tier.id }
}

function filesOf(paperId) {
  return FILES[paperId] || { thumbFileId: '', originFileId: '' }
}

function isDone(status) {
  return status === 'completed' || status === 'fulfilled'
}

function stripPaper(w) {
  if (!w) return w
  const out = Object.assign({}, w)
  delete out.paperId
  delete out.paperTier
  out.hasSurprise = true
  return out
}

async function signUrl(cloud, fileId) {
  if (!fileId) return ''
  try {
    const r = await cloud.getTempFileURL({ fileList: [fileId] })
    const item = r && r.fileList && r.fileList[0]
    return (item && item.tempFileURL) || ''
  } catch (e) {
    return ''
  }
}

function publicWish(w) {
  if (!w) return w
  return stripPaper(w)
}

async function publicWishDetail(cloud, w) {
  if (!w) return w
  const out = stripPaper(w)
  if (!isDone(w.status)) return out
  const files = filesOf(w.paperId)
  out.thumbUrl = await signUrl(cloud, files.thumbFileId)
  return out
}

module.exports = {
  pickPaper,
  filesOf,
  isDone,
  stripPaper,
  publicWish,
  publicWishDetail,
  signUrl,
  tierOfGoal,
}
