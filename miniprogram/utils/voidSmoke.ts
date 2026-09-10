// 一根青烟：下部细直，上部加大曲度缭绕。不描线，避免看起来像光柱。

export interface VoidSmokeHandle {
  stop: () => void
}

/** 调参入口。一根烟，上部缭绕。 */
export const CONFIG = {
  particleCount: 56,
  pathSamples: 40,
  riseSpeedMin: 0.16,
  riseSpeedMax: 0.3,
  turbulence: 0.004,
  /** 顶部最大摆幅（相对屏宽）；下部会被压到接近 0 */
  swayAmpRatio: 0.17,
  swayFreq: 0.009,
  minSize: 1.4,
  maxSize: 15,
  maxAlpha: 0.09,
  curlStrength: 1.25,
  curlRadiusRatio: 0.14,
  curlStart: 0.4,
  animationSpeed: 0.00013,
  originXRatio: 0.5,
  originYRatio: 0.86,
  riseRatio: 0.62,
}

const SPRITE = 48

interface SmokeParticle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  alpha: number
  life: number
  maxLife: number
  phase: number
  frequency: number
  amplitude: number
  layer: number
  fade: number
}

function clamp(n: number, a: number, b: number): number {
  return n < a ? a : n > b ? b : n
}

function bakeSprite(): any {
  try {
    const anyWx: any = wx
    if (typeof anyWx.createOffscreenCanvas !== 'function') return null
    const off = anyWx.createOffscreenCanvas({ type: '2d', width: SPRITE, height: SPRITE })
    if (!off) return null
    try {
      off.width = SPRITE
      off.height = SPRITE
    } catch {
      // 部分基础库创建时已带宽高
    }
    const octx = off.getContext('2d')
    if (!octx) return null
    const c = SPRITE * 0.5
    const g = octx.createRadialGradient(c, c, 0, c, c, c)
    g.addColorStop(0, 'rgba(168, 204, 210, 0.42)')
    g.addColorStop(0.34, 'rgba(148, 190, 198, 0.16)')
    g.addColorStop(0.68, 'rgba(120, 168, 176, 0.04)')
    g.addColorStop(1, 'rgba(100, 150, 155, 0)')
    octx.fillStyle = g
    octx.beginPath()
    octx.arc(c, c, c, 0, Math.PI * 2)
    octx.fill()
    return off
  } catch {
    return null
  }
}

function createParticle(): SmokeParticle {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    size: 2,
    alpha: 0,
    life: 1,
    maxLife: 1,
    phase: 0,
    frequency: 1,
    amplitude: 1,
    layer: 1,
    fade: 0,
  }
}

export function startVoidSmoke(canvas: any, cssW: number, cssH: number, dpr: number): VoidSmokeHandle {
  const ctx = canvas.getContext('2d')
  if (!ctx) return { stop() {} }

  const pixelRatio = Math.max(1, Math.min(dpr || 2, 2))
  canvas.width = Math.max(1, Math.round(cssW * pixelRatio))
  canvas.height = Math.max(1, Math.round(cssH * pixelRatio))
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

  const originX = cssW * CONFIG.originXRatio
  const originY = cssH * CONFIG.originYRatio
  const rise = cssH * CONFIG.riseRatio
  const topY = originY - rise
  const swayAmp = cssW * CONFIG.swayAmpRatio
  const curlRadius = cssW * CONFIG.curlRadiusRatio
  const sprite = bakeSprite()
  const samples = CONFIG.pathSamples
  const pathX = new Float32Array(samples)
  const pathY = new Float32Array(samples)
  const trailX = new Float32Array(samples)
  const particles: SmokeParticle[] = new Array(CONFIG.particleCount)
  for (let i = 0; i < CONFIG.particleCount; i++) particles[i] = createParticle()

  let raf = 0
  let running = true
  let lastNow = 0
  const layerGain = [0.9, 0.4]
  const layerSize = [0.55, 1.05]

  const schedule = (fn: () => void): number => {
    if (canvas.requestAnimationFrame) return canvas.requestAnimationFrame(fn)
    return setTimeout(fn, 16) as unknown as number
  }
  const cancel = (id: number) => {
    if (canvas.cancelAnimationFrame) canvas.cancelAnimationFrame(id)
    else clearTimeout(id)
  }

  // 一根烟的中心线：下半段贴着竖线，过 curlStart 后用 S 弯慢慢缭绕
  const columnX = (y: number, t: number): number => {
    const u = clamp((originY - y) / rise, 0, 1)
    const open = Math.pow(clamp((u - 0.08) / 0.92, 0, 1), 2.35)
    const s1 = Math.sin(t * CONFIG.animationSpeed * 3.1 + u * 2.6)
    const s2 = Math.sin(t * CONFIG.animationSpeed * 1.9 + u * 5.1 + 1.05)
    const sway = (s1 * 0.62 + s2 * 0.7) * swayAmp * open
    let curl = 0
    if (u > CONFIG.curlStart) {
      const k = (u - CONFIG.curlStart) / (1 - CONFIG.curlStart)
      const ang = t * CONFIG.animationSpeed * 2.05 + u * 3.8
      curl =
        Math.sin(ang) * curlRadius * k * k * CONFIG.curlStrength +
        Math.sin(ang * 0.5 + 2.05) * curlRadius * 0.95 * k * CONFIG.curlStrength
    }
    return originX + sway + curl
  }

  const puffAlpha = (u: number): number => {
    const fadeIn = clamp(u / 0.05, 0, 1)
    const fadeOut = 1 - clamp((u - 0.74) / 0.26, 0, 1)
    return fadeIn * fadeOut
  }

  const puffSize = (u: number): number => {
    return CONFIG.minSize + Math.pow(u, 1.55) * (CONFIG.maxSize - CONFIG.minSize)
  }

  const drawPuff = (x: number, y: number, size: number, alpha: number) => {
    if (alpha < 0.004 || size < 0.4) return
    if (sprite) {
      ctx.globalAlpha = alpha
      ctx.drawImage(sprite, x - size, y - size, size * 2, size * 2)
      return
    }
    const g = ctx.createRadialGradient(x, y, 0, x, y, size)
    g.addColorStop(0, 'rgba(168, 204, 210, ' + (alpha * 0.7).toFixed(3) + ')')
    g.addColorStop(0.5, 'rgba(130, 176, 184, ' + (alpha * 0.18).toFixed(3) + ')')
    g.addColorStop(1, 'rgba(100, 150, 155, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()
  }

  const samplePath = (t: number, destX: Float32Array) => {
    for (let i = 0; i < samples; i++) {
      const u = i / (samples - 1)
      const y = originY - u * rise
      pathY[i] = y
      destX[i] = columnX(y, t)
    }
  }

  const resetParticle = (p: SmokeParticle, along: number) => {
    const u = clamp(along, 0, 0.96)
    const now = lastNow || Date.now()
    p.phase = Math.random() * Math.PI * 2
    p.frequency = 0.0008 + Math.random() * 0.0006
    p.amplitude = 0.4 + Math.random() * 0.5
    p.maxLife = 10000 + Math.random() * 7000
    p.life = p.maxLife * (1 - u * 0.7)
    p.vy = -(CONFIG.riseSpeedMin + Math.random() * (CONFIG.riseSpeedMax - CONFIG.riseSpeedMin))
    p.vx = 0
    p.y = originY - u * rise
    p.x = columnX(p.y, now)
    p.size = CONFIG.minSize
    p.alpha = 0
    p.fade = u < 0.02 ? 0 : 1
  }

  const initSmoke = () => {
    const n = CONFIG.particleCount
    const coreN = Math.floor(n * 0.45)
    for (let i = 0; i < n; i++) {
      const p = particles[i]
      p.layer = i < coreN ? 0 : 1
      resetParticle(p, (i + 0.5) / n)
    }
  }

  const drawEmber = (now: number) => {
    const pulse = 0.72 + Math.sin(now * 0.001) * 0.12
    const ember = ctx.createRadialGradient(originX, originY, 0, originX, originY, 11)
    ember.addColorStop(0, 'rgba(255, 92, 44, ' + (0.72 * pulse).toFixed(3) + ')')
    ember.addColorStop(0.42, 'rgba(190, 40, 14, ' + (0.22 * pulse).toFixed(3) + ')')
    ember.addColorStop(1, 'rgba(60, 8, 0, 0)')
    ctx.fillStyle = ember
    ctx.beginPath()
    ctx.arc(originX, originY, 11, 0, Math.PI * 2)
    ctx.fill()
  }

  const updateSmoke = (now: number, dt: number) => {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      const climb = clamp((originY - p.y) / rise, 0, 1)
      const curlK = climb > CONFIG.curlStart ? (climb - CONFIG.curlStart) / (1 - CONFIG.curlStart) : 0

      p.vx += Math.sin(now * p.frequency + p.phase + p.y * 0.01) * CONFIG.turbulence * p.amplitude * climb
      if (curlK > 0) {
        p.vx += Math.cos(now * CONFIG.animationSpeed * 2.4 + p.phase) * 0.02 * curlK * curlK
      }
      p.vx *= 0.93
      p.y += p.vy * dt * (1 - curlK * 0.45)
      p.x += p.vx * dt
      p.x += (columnX(p.y, now) - p.x) * (0.08 + (1 - climb) * 0.06) * dt

      p.life -= 16.67 * dt
      p.fade = clamp(p.fade + dt * 0.04, 0, 1)

      const born = 1 - p.life / p.maxLife
      const fadeIn = clamp(born / 0.08, 0, 1) * p.fade
      const fadeOut = puffAlpha(climb)
      const lifeFade = p.life < 800 ? p.life / 800 : 1

      p.size = puffSize(climb) * layerSize[p.layer]
      p.alpha = CONFIG.maxAlpha * layerGain[p.layer] * fadeIn * fadeOut * lifeFade

      if (p.life <= 0 || p.y < topY - 20 || (climb > 0.98 && p.alpha < 0.004)) {
        resetParticle(p, 0)
      }
    }
  }

  const drawWisp = (now: number) => {
    samplePath(now - 1100, trailX)
    samplePath(now, pathX)

    // 上部留下淡痕，让缭绕显出体积，而不是第二根烟
    for (let i = 0; i < samples; i++) {
      const u = i / (samples - 1)
      if (u < CONFIG.curlStart) continue
      const k = (u - CONFIG.curlStart) / (1 - CONFIG.curlStart)
      drawPuff(trailX[i], pathY[i], puffSize(u) * 1.25, CONFIG.maxAlpha * 0.28 * puffAlpha(u) * k)
    }

    for (let i = 0; i < samples; i++) {
      const u = i / (samples - 1)
      drawPuff(pathX[i], pathY[i], puffSize(u), CONFIG.maxAlpha * 0.85 * puffAlpha(u))
    }
  }

  const drawSmoke = (now: number) => {
    ctx.clearRect(0, 0, cssW, cssH)
    ctx.globalAlpha = 1
    drawWisp(now)

    for (let i = 0; i < particles.length; i++) {
      if (particles[i].layer === 1) drawPuff(particles[i].x, particles[i].y, particles[i].size, particles[i].alpha)
    }
    ctx.globalAlpha = 1
    for (let i = 0; i < particles.length; i++) {
      if (particles[i].layer === 0) drawPuff(particles[i].x, particles[i].y, particles[i].size, particles[i].alpha)
    }
    ctx.globalAlpha = 1
    drawEmber(now)
  }

  const tick = () => {
    if (!running) return
    const now = Date.now()
    if (!lastNow) lastNow = now
    const dt = clamp((now - lastNow) / 16.67, 0.5, 2.2)
    lastNow = now
    updateSmoke(now, dt)
    drawSmoke(now)
    raf = schedule(tick)
  }

  initSmoke()
  raf = schedule(tick)

  return {
    stop() {
      running = false
      if (raf) cancel(raf)
      raf = 0
    },
  }
}
