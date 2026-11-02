const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const WIPE = [
  'channels',
  'channel_applications',
  'channel_operators',
  'channel_bind_codes',
  'channel_users',
  'channel_commissions',
  'channel_owners',
  'channel_settlements',
]

async function wipeCollection(name) {
  let removed = 0
  try {
    for (;;) {
      const r = await db.collection(name).limit(20).get()
      const rows = r.data || []
      if (!rows.length) return { name, removed }
      for (let i = 0; i < rows.length; i++) {
        await db.collection(name).doc(rows[i]._id).remove()
        removed++
      }
    }
  } catch (e) {
    const msg = (e && e.message) || String(e)
    if (/not exist|不存在|not found/i.test(msg) && removed === 0) {
      return { name, removed: 0, missing: true }
    }
    return { name, removed, error: msg }
  }
}

exports.main = async () => {
  const results = []
  for (let i = 0; i < WIPE.length; i++) {
    results.push(await wipeCollection(WIPE[i]))
  }
  return { ok: true, results }
}
