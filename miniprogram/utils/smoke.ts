// 檀香青烟用「柔边粒子纹理」：运行时程序化生成径向渐变 RGBA 纹理，
// 并通过 xr-frame 的 registerTexture 注册为内置资源 smoke-dot，
// 无需携带/下载任何图片资源。
// 同时提供 xrSystem() 能力探测，供页面决定是否挂载 XR 组件。

const TEXTURE_ID = 'smoke-dot'
const SIZE = 64 // 纹理边长（2 的幂，越小越省显存）
let registered = false
let warned = false

/** 获取当前运行环境的 XR-Frame 系统对象；不支持时返回 null */
export function xrSystem(): any {
  try {
    const anyWx: any = wx
    const sys =
      (anyWx.requireXRFrame && anyWx.requireXRFrame()) ||
      (anyWx.getXrFrameSystem && anyWx.getXrFrameSystem())
    if (!sys && !warned) {
      warned = true
      console.warn('[smoke] 当前基础库/客户端不支持 XR-Frame，青烟特效将不启用')
    }
    return sys || null
  } catch (e) {
    if (!warned) {
      warned = true
      console.warn('[smoke] 获取 XR-Frame 失败，青烟特效将不启用', e)
    }
    return null
  }
}

/** 生成一张中心亮、边缘柔化衰减的白色圆点（RGBA8 像素流） */
function buildSoftDot(): Uint8Array {
  const data = new Uint8Array(SIZE * SIZE * 4)
  const half = SIZE / 2
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x + 0.5 - half) / half
      const dy = (y + 0.5 - half) / half
      const r = Math.sqrt(dx * dx + dy * dy)
      // 二次衰减：中心 1 → 边缘 0，得到无锯齿的柔边圆
      let a = 1 - Math.min(1, r)
      a = Math.max(0, a * a * (3 - 2 * a)) // smoothstep 增强过渡
      const idx = (y * SIZE + x) * 4
      data[idx] = 252 // R
      data[idx + 1] = 254 // G
      data[idx + 2] = 255 // B（淡青白）
      data[idx + 3] = Math.round(255 * a)
    }
  }
  return data
}

function makeTexture(scene: any): any {
  try {
    return scene.createTexture({
      width: SIZE,
      height: SIZE,
      source: [buildSoftDot()],
    })
  } catch {
    // 极端兜底：1x1 白色像素，仅保证不白屏
    return scene.createTexture({
      width: 1,
      height: 1,
      source: [new Uint8Array([255, 255, 255, 255])],
    })
  }
}

/** 幂等：向 xr-frame 注册 smoke-dot 纹理。返回是否注册成功 */
export function ensureSmokeTexture(): boolean {
  if (registered) return true
  const sys = xrSystem()
  if (!sys || typeof sys.registerTexture !== 'function') {
    console.warn('[smoke] XR-Frame 未暴露 registerTexture，无法注册 smoke-dot')
    return false
  }
  try {
    sys.registerTexture(TEXTURE_ID, (scene: any) => makeTexture(scene))
    registered = true
    return true
  } catch (e) {
    console.warn('[smoke] 注册 smoke-dot 失败', e)
    return false
  }
}
