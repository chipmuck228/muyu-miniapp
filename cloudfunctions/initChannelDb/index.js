const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTIONS = [
  'channels',
  'channel_operators',
  'channel_bind_codes',
  'channel_users',
  'channel_commissions',
  'channel_admins',
  'channel_applications',
  'channel_owners',
  'channel_settlements',
]

async function ensureCollection(name) {
  try {
    await db.createCollection(name)
    return { name, created: true }
  } catch (e) {
    const msg = (e && e.message) || String(e)
    if (/already exist|existed|已存在/i.test(msg)) return { name, created: false, existed: true }
    return { name, created: false, error: msg }
  }
}

exports.main = async () => {
  const results = []
  for (let i = 0; i < COLLECTIONS.length; i++) {
    results.push(await ensureCollection(COLLECTIONS[i]))
  }
  return { ok: true, results }
}
