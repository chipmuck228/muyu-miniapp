// 把 three 的 CJS 构建拷进 miniprogram_npm，供微信解析 require('three')
const fs = require('fs')
const path = require('path')

async function main() {
  const root = path.join(__dirname, '..')
  const dest = path.join(root, 'miniprogram', 'pkg-smoke', 'miniprogram_npm', 'three')
  const src = path.join(root, 'node_modules', 'three', 'build', 'three.cjs')

  if (!fs.existsSync(src)) {
    console.error('missing node_modules/three/build/three.cjs — run npm install')
    process.exit(1)
  }

  fs.mkdirSync(dest, { recursive: true })
  const destJs = path.join(dest, 'index.js')
  const raw = fs.readFileSync(src, 'utf8')
  try {
    const { minify } = require('terser')
    const out = await minify(raw, { compress: true, mangle: true })
    fs.writeFileSync(destJs, out.code || raw)
  } catch (e) {
    console.warn('terser skipped', e && e.message)
    fs.writeFileSync(destJs, raw)
  }
  fs.writeFileSync(
    path.join(dest, 'package.json'),
    JSON.stringify(
      { name: 'three', version: '0.170.0', main: 'index.js', miniprogram: '.' },
      null,
      2
    )
  )
  console.log('packed three -> miniprogram/pkg-smoke/miniprogram_npm/three')
}

main()
