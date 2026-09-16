const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function codeEnv(v) {
  return v === 'release' ? 'release' : 'trial'
}

function randKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

async function uniquePromoKey() {
  for (let i = 0; i < 8; i++) {
    const c = randKey()
    const had = await db.collection('channels').where({ promoKey: c }).limit(1).get()
    if (!had.data || !had.data.length) return c
  }
  return ('P' + Date.now().toString(36)).slice(0, 8).toUpperCase()
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const channelId = String((event && event.channelId) || '').trim()
  if (!channelId) return { ok: false, success: false, msg: '缺少渠道 id' }
  try {
    const chDoc = await db.collection('channels').doc(channelId).get().catch(() => null)
    const ch = chDoc && chDoc.data
    const mine = ch && (ch.boundOpenid === OPENID || ch.authorizedOpenid === OPENID)
    if (!ch || !mine || ch.status !== 'active') {
      return { ok: false, success: false, msg: '无渠道权限' }
    }

    let promoKey = String(ch.promoKey || '').trim().toUpperCase()
    if (!/^[A-Z0-9]{8}$/.test(promoKey)) {
      promoKey = await uniquePromoKey()
      await db.collection('channels').doc(channelId).update({ data: { promoKey } })
    }

    const envVersion = codeEnv(event && event.envVersion)
    const scene = 'ch_' + promoKey
    const code = await cloud.openapi.wxacode.getUnlimited({
      scene,
      page: 'pages/home/index',
      checkPath: false,
      envVersion,
      width: 280,
    })
    const buf = code && (code.buffer || code.fileBuffer)
    if (!buf) return { ok: false, success: false, msg: '小程序码生成失败' }
    const up = await cloud.uploadFile({
      cloudPath: 'channel-qr/' + channelId + '-' + promoKey + '-' + envVersion + '.png',
      fileContent: Buffer.isBuffer(buf) ? buf : Buffer.from(buf),
    })
    return { ok: true, success: true, fileID: up.fileID, scene, envVersion, promoKey }
  } catch (e) {
    return { ok: false, success: false, msg: (e && e.message) || '生成失败' }
  }
}
