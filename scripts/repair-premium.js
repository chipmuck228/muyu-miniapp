// 扫描 premium_orders 里 status=created 的历史订单，向微信逐一确认，
// 凡是查到已支付的就把 users.premium 补齐（即"补发货"）。
//
// 默认只做 dry-run（不写库），确认无误后加 --apply 才真正写入。
//
// 用法：
//   node scripts/repair-premium.js --env=你的云环境ID
//   node scripts/repair-premium.js --env=xxx --apply
//   node scripts/repair-premium.js --env=xxx --apply --limit=20
//
// 前置：
//   1. 先上传部署 cloudfunctions/pay（含本次 repair 改动）
//   2. 在 pay/secrets.js 里加一行 repairKey: '一串随机字符串'
//      （或用环境变量 XPAY_REPAIR_KEY），否则云函数会拒绝执行
//   3. appSecret 必须已填（查微信订单要用）

const https = require('https')
const path = require('path')

function arg(name, fallback) {
  const hit = process.argv.find((a) => a === '--' + name || a.indexOf('--' + name + '=') === 0)
  if (!hit) return fallback
  const eq = hit.indexOf('=')
  return eq > 0 ? hit.slice(eq + 1) : true
}

function has(name) {
  return process.argv.some((a) => a === '--' + name)
}

function loadSecrets() {
  try {
    return require(path.join(__dirname, '..', 'cloudfunctions', 'pay', 'secrets'))
  } catch (e) {
    return {}
  }
}

function request(url, body) {
  const data = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8')
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: data ? 'POST' : 'GET',
        headers: data
          ? {
              'Content-Type': 'application/json',
              'Content-Length': data.length,
            }
          : {},
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => {
          raw += c
        })
        res.on('end', () => {
          let json
          try {
            json = raw ? JSON.parse(raw) : {}
          } catch (e) {
            reject(new Error('返回不是合法 JSON：' + raw.slice(0, 300)))
            return
          }
          resolve(json)
        })
      }
    )
    req.setTimeout(60000, () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

async function main() {
  const secrets = loadSecrets()
  const appId = String(arg('appid', process.env.XPAY_APP_ID || secrets.appId || '')).trim()
  const appSecret = String(arg('secret', process.env.XPAY_APP_SECRET || secrets.appSecret || '')).trim()
  const repairKey = String(arg('key', process.env.XPAY_REPAIR_KEY || secrets.repairKey || '')).trim()
  const envId = String(arg('env', process.env.XPAY_ENV_ID || process.env.WECHAT_ENV_ID || '')).trim()
  const dryRun = !has('apply')
  const limit = Number(arg('limit', '0')) || 50

  const missing = []
  if (!appId) missing.push('appid（--appid=... 或 secrets.js 的 appId）')
  if (!appSecret) missing.push('appSecret（--secret=... 或 secrets.js 的 appSecret）')
  if (!envId) missing.push('云环境 ID（--env=...，在云开发控制台「环境 → 环境 ID」查看）')
  if (!repairKey) missing.push('repairKey（pay/secrets.js 里加 repairKey，或 --key=...）')
  if (missing.length) {
    console.error('缺少必要参数：')
    missing.forEach((m) => console.error('  - ' + m))
    process.exit(1)
  }

  console.log(dryRun ? '== dry-run（只读，不写库）==' : '== apply（会写入 users.premium）==')

  const tokenRes = await request(
    'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' +
      encodeURIComponent(appId) +
      '&secret=' +
      encodeURIComponent(appSecret)
  )
  if (!tokenRes || !tokenRes.access_token) {
    console.error('换取 access_token 失败：', JSON.stringify(tokenRes))
    process.exit(1)
  }
  const token = tokenRes.access_token

  let skip = Number(arg('skip', '0')) || 0
  const totals = {
    scanned: 0,
    paid: 0,
    granted: 0,
    alreadyPremium: 0,
    unpaid: 0,
    queryFailed: 0,
    noOpenid: 0,
  }
  const all = []

  for (let round = 0; round < 200; round++) {
    const url =
      'https://api.weixin.qq.com/tcb/invokecloudfunction?access_token=' +
      encodeURIComponent(token) +
      '&env=' +
      encodeURIComponent(envId) +
      '&name=pay'
    const outer = await request(url, {
      action: 'repair',
      key: repairKey,
      dryRun,
      limit,
      skip,
    })

    if (outer == null || outer.errcode) {
      console.error('调用云函数失败：', JSON.stringify(outer))
      process.exit(1)
    }

    let result = outer
    if (typeof outer.resp_data === 'string') {
      try {
        result = JSON.parse(outer.resp_data)
      } catch (e) {
        result = outer
      }
    }

    if (!result || result.ok === false) {
      console.error('repair 被拒绝：', JSON.stringify(result))
      process.exit(1)
    }

    const rep = result.report || {}
    Object.keys(totals).forEach((k) => {
      totals[k] += Number(rep[k] || 0)
    })
    ;(rep.grantedOrders || []).forEach((no) => all.push(no))

    console.log(
      '第 ' + (round + 1) + ' 批：扫描 ' + rep.scanned + ' / 已支付 ' + rep.paid + ' / 缺 openid ' + rep.noOpenid
    )

    if (rep.stopped) {
      console.log('  本批因时间预算中断，请带上 --skip=' + skip + ' 继续')
      break
    }
    if (result.done) break
    skip = result.nextSkip
  }

  console.log('\n===== 汇总 =====')
  console.log('扫描订单数    :', totals.scanned)
  console.log('微信侧已支付  :', totals.paid)
  console.log('未支付        :', totals.unpaid)
  console.log('查询失败      :', totals.queryFailed, '(可在网络好转后重跑)')
  console.log('缺少 openid   :', totals.noOpenid)
  console.log('此前已开通    :', totals.alreadyPremium)
  console.log(dryRun ? '待补发货      :' : '已补发货      :', all.length)
  if (all.length) console.log('涉及订单号    :\n  ' + all.join('\n  '))

  if (dryRun && all.length) {
    console.log('\n确认无误后加 --apply 再跑一次即可写入 users.premium。')
  }
}

main().catch((e) => {
  console.error(e && (e.stack || e.message || String(e)))
  process.exit(1)
})
