// 香案青烟：WebGL1 软边丝带。上升全程随机扰动，顶部慢转张开后淡出。

import { adaptForMiniProgram } from './threeAdapt'

export const SMOKE_REV = 'v20260910af'

export interface SmokeTint {
  ember: [number, number, number]
  plume: [number, number, number]
}

export interface VoidSmokeHandle {
  setTint: (tint: SmokeTint) => void
  /** 烟头相对默认位置下移（占画布高度的比例，负数为上移），一炷香燃烧时用；会缓动过去 */
  setSink: (ratio: number) => void
  /** 整体淡出（0..1）。外层 CSS opacity 管不到 WebGL 画布，淡出只能画在这里；instant 跳过缓动 */
  setFade: (alpha: number, instant?: boolean) => void
  stop: () => void
}

export const CONFIG = {
  strands: 1,
  stemPts: 140,
  vortexPts: 40,
  pixelRatio: 1.5,
  riseSpeed: 0.18,
  originYRatio: 0.86,
  curlFromTop: 1 / 3,
  minWidth: 2,
  stemWidth: 9,
  vortexWidth: 14,
  bottomAlpha: 0.58,
  topAlpha: 0.22,
  holdMs: 280,
  scatterMs: 2200,
  vortexAmpRatio: 0.08,
}

const VERT = `
precision mediump float;
attribute vec2 aPos;
attribute float aV;
attribute float aAlpha;
attribute float aSoft;
uniform mat4 uProj;
varying float vAlpha;
varying float vSoft;
varying float vV;
void main() {
  vAlpha = aAlpha;
  vSoft = aSoft;
  vV = aV;
  gl_Position = uProj * vec4(aPos, 0.0, 1.0);
}
`

const FRAG = `
precision mediump float;
uniform vec3 uColor;
uniform float uFade;
varying float vAlpha;
varying float vSoft;
varying float vV;
void main() {
  float inner = mix(0.18, 0.06, clamp(vSoft, 0.0, 1.0));
  float edge = 1.0 - smoothstep(inner, 1.0, abs(vV));
  float a = vAlpha * edge;
  if (a < 0.012) discard;
  gl_FragColor = vec4(uColor, a * uFade);
}
`

interface RibbonPoint {
  x: number
  y: number
  w: number
  alpha: number
  soft: number
}

function clamp(n: number, a: number, b: number): number {
  return n < a ? a : n > b ? b : n
}

function grabGl(el: any): any {
  const opts = { alpha: true, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false }
  return (
    el.getContext('webgl', opts) ||
    el.getContext('experimental-webgl', opts) ||
    el.getContext('webgl') ||
    null
  )
}

function ortho(w: number, h: number): Float32Array {
  const l = -w * 0.5
  const r = w * 0.5
  const b = -h * 0.5
  const t = h * 0.5
  const n = -80
  const f = 80
  return new Float32Array([
    2 / (r - l),
    0,
    0,
    0,
    0,
    2 / (t - b),
    0,
    0,
    0,
    0,
    -2 / (f - n),
    0,
    -(r + l) / (r - l),
    -(t + b) / (t - b),
    -(f + n) / (f - n),
    1,
  ])
}

function compile(gl: any, type: number, src: string): any {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('createShader failed')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = String(gl.getShaderInfoLog(sh) || 'compile fail').replace(/\s+/g, ' ').slice(0, 80)
    gl.deleteShader(sh)
    throw new Error(log)
  }
  return sh
}

function linkProgram(gl: any): any {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
  const prog = gl.createProgram()
  if (!prog) throw new Error('createProgram failed')
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = String(gl.getProgramInfoLog(prog) || 'link fail').replace(/\s+/g, ' ').slice(0, 80)
    gl.deleteProgram(prog)
    throw new Error(log)
  }
  return prog
}

export function startIncensePlume(
  canvas: any,
  cssW: number,
  cssH: number,
  dpr: number,
  onRise?: () => void,
  tint?: SmokeTint,
): VoidSmokeHandle {
  console.log('[smoke]', SMOKE_REV, cssW, cssH)
  const pixelRatio = Math.max(1, Math.min(dpr || CONFIG.pixelRatio, CONFIG.pixelRatio))
  const pixelW = Math.max(1, Math.round(cssW * pixelRatio))
  const pixelH = Math.max(1, Math.round(cssH * pixelRatio))

  const adapted = adaptForMiniProgram(canvas, { canvasWidth: pixelW, canvasHeight: pixelH })
  const gl = grabGl(adapted.canvas)
  if (!gl) {
    adapted.dispose()
    throw new Error('webgl unavailable')
  }

  const prog = linkProgram(gl)
  const aPos = gl.getAttribLocation(prog, 'aPos')
  const aV = gl.getAttribLocation(prog, 'aV')
  const aAlpha = gl.getAttribLocation(prog, 'aAlpha')
  const aSoft = gl.getAttribLocation(prog, 'aSoft')
  const uProj = gl.getUniformLocation(prog, 'uProj')
  const uColor = gl.getUniformLocation(prog, 'uColor')
  const uFade = gl.getUniformLocation(prog, 'uFade')
  const proj = ortho(cssW, cssH)
  const color = {
    ember: [1, 0.36, 0.16] as [number, number, number],
    plume: [0.8, 0.82, 0.84] as [number, number, number],
  }
  const useTint = (next?: SmokeTint) => {
    if (!next || !next.ember || !next.plume) return
    color.ember = [next.ember[0], next.ember[1], next.ember[2]]
    color.plume = [next.plume[0], next.plume[1], next.plume[2]]
  }
  useTint(tint)

  let originY = cssH * (0.5 - CONFIG.originYRatio)
  const screenTop = cssH * 0.5
  const curlY = screenTop - cssH * CONFIG.curlFromTop
  let stemH = Math.max(1, curlY - originY)
  let originTarget = originY
  let fade = 1
  let fadeTarget = 1
  const growMs = (stemH / CONFIG.riseSpeed) * 16.67
  const vortexSpan = CONFIG.holdMs + CONFIG.scatterMs
  const strandN = CONFIG.strands
  const stemN = CONFIG.stemPts
  const vortexN = CONFIG.vortexPts
  const maxPts = stemN + vortexN

  const strandPhase: number[] = []
  const pointSeed: number[][] = []
  const pointSeedB: number[][] = []
  for (let s = 0; s < strandN; s++) {
    strandPhase[s] = Math.random() * Math.PI * 2
    pointSeed[s] = new Array(maxPts)
    pointSeedB[s] = new Array(maxPts)
    for (let i = 0; i < maxPts; i++) {
      pointSeed[s][i] = Math.random() * Math.PI * 2
      pointSeedB[s][i] = Math.random() * Math.PI * 2
    }
  }

  const points: RibbonPoint[][] = []
  for (let s = 0; s < strandN; s++) {
    points[s] = []
    for (let i = 0; i < maxPts; i++) {
      points[s][i] = { x: 0, y: originY, w: CONFIG.minWidth, alpha: 0, soft: 0 }
    }
  }

  const vertsPerStrand = Math.max(6, (maxPts - 1) * 6)
  const pos = new Float32Array(vertsPerStrand * 2)
  const across = new Float32Array(vertsPerStrand)
  const alphas = new Float32Array(vertsPerStrand)
  const softs = new Float32Array(vertsPerStrand)

  const bufPos = gl.createBuffer()
  const bufV = gl.createBuffer()
  const bufAlpha = gl.createBuffer()
  const bufSoft = gl.createBuffer()

  const emberPos = new Float32Array([-7, originY - 7, 7, originY - 7, 7, originY + 7, -7, originY - 7, 7, originY + 7, -7, originY + 7])
  const emberV = new Float32Array([-1, 1, 1, -1, 1, -1])
  const emberA = new Float32Array(6)
  const emberS = new Float32Array([1, 1, 1, 1, 1, 1])
  const bufEmberPos = gl.createBuffer()
  const bufEmberV = gl.createBuffer()
  const bufEmberA = gl.createBuffer()
  const bufEmberS = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, bufEmberPos)
  gl.bufferData(gl.ARRAY_BUFFER, emberPos, gl.STATIC_DRAW)
  gl.bindBuffer(gl.ARRAY_BUFFER, bufEmberV)
  gl.bufferData(gl.ARRAY_BUFFER, emberV, gl.STATIC_DRAW)
  gl.bindBuffer(gl.ARRAY_BUFFER, bufEmberS)
  gl.bufferData(gl.ARRAY_BUFFER, emberS, gl.STATIC_DRAW)

  const placeEmber = () => {
    const ys = [originY - 7, originY - 7, originY + 7, originY - 7, originY + 7, originY + 7]
    for (let i = 0; i < 6; i++) emberPos[i * 2 + 1] = ys[i]
    gl.bindBuffer(gl.ARRAY_BUFFER, bufEmberPos)
    gl.bufferData(gl.ARRAY_BUFFER, emberPos, gl.STATIC_DRAW)
  }

  let ampScale = 1
  let ampTarget = 1
  let ampNextAt = Date.now() + 1600

  const waveX = (t: number, u: number, phase: number): number => {
    return (
      Math.sin(u * Math.PI * 0.68 + t * 0.00015 + phase) * 0.78 +
      Math.sin(u * Math.PI * 1.08 + t * 0.00021 + phase * 1.2) * 0.18 +
      Math.sin(u * Math.PI * 0.32 + t * 0.00009 + phase * 0.7) * 0.04
    )
  }

  const easeOut = (t: number): number => {
    const x = clamp(t, 0, 1)
    return x * x * (3 - 2 * x)
  }

  const smoothChain = (list: RibbonPoint[], from: number, to: number, passes: number, lockY: boolean) => {
    for (let pass = 0; pass < passes; pass++) {
      for (let i = from + 1; i < to - 1; i++) {
        const a = list[i - 1]
        const b = list[i]
        const c = list[i + 1]
        if (b.alpha <= 0.01 || a.alpha <= 0.01 || c.alpha <= 0.01) continue
        b.x = a.x * 0.28 + b.x * 0.44 + c.x * 0.28
        if (!lockY) b.y = a.y * 0.22 + b.y * 0.56 + c.y * 0.22
      }
    }
  }

  const fillStrand = (s: number, now: number, growU: number) => {
    const phase = strandPhase[s]
    const liveStem = Math.max(2, Math.ceil(growU * (stemN - 1)) + 1)
    const showVortex = growU >= 1
    if (now >= ampNextAt) {
      ampTarget = 0.78 + Math.random() * 0.5
      ampNextAt = now + 2800 + Math.random() * 4200
    }
    ampScale += (ampTarget - ampScale) * 0.012

    for (let i = 0; i < stemN; i++) {
      const p = points[s][i]
      if (i >= liveStem) {
        p.alpha = 0
        continue
      }
      const along = i / Math.max(1, liveStem - 1)
      const stemU = clamp(along * growU, 0, 1)
      const amp = (5 + stemU * 30) * ampScale
      p.x = waveX(now, stemU, phase) * amp
      p.y = originY + stemU * stemH
      p.w = CONFIG.minWidth + Math.pow(stemU, 1.15) * (CONFIG.stemWidth - CONFIG.minWidth)
      p.soft = 0.4 + stemU * 0.5
      p.alpha = CONFIG.bottomAlpha * (1 - stemU * 0.55)
      if (growU < 1) {
        const tip = 0.62 + 0.38 * easeOut(clamp((1 - along) / 0.14, 0, 1))
        p.w *= tip
        p.alpha *= 0.55 + 0.45 * tip
        p.soft = clamp(p.soft + (1 - tip) * 0.25, 0, 1)
      }
    }

    for (let j = 0; j < vortexN; j++) {
      const p = points[s][stemN + j]
      if (!showVortex) {
        p.alpha = 0
        continue
      }
      const v = j / Math.max(1, vortexN - 1)
      const u = 1 + v * 0.22
      const fade = easeOut(1 - v)
      p.x = waveX(now, u, phase) * (5 + 30) * ampScale + Math.sin(now * 0.00012 + pointSeed[s][stemN + j]) * v * 5
      p.y = curlY + v * 28
      p.w = CONFIG.stemWidth + v * (CONFIG.vortexWidth - CONFIG.stemWidth)
      p.soft = 0.82 + v * 0.18
      p.alpha = CONFIG.topAlpha * fade
    }
    if (showVortex) smoothChain(points[s], stemN - 1, stemN + vortexN, 2, false)
  }

  const writeStrip = (strand: RibbonPoint[], count: number, wMul = 1, aMul = 1, softAdd = 0): number => {
    const live: RibbonPoint[] = []
    for (let i = 0; i < count; i++) {
      if (strand[i].alpha > 0.01) live.push(strand[i])
    }
    if (live.length < 2) return 0
    let n = 0
    const vert = (x: number, y: number, v: number, alpha: number, soft: number) => {
      if (n >= vertsPerStrand) return
      pos[n * 2] = x
      pos[n * 2 + 1] = y
      across[n] = v
      alphas[n] = alpha
      softs[n] = soft
      n += 1
    }
    const quad = (
      x0: number,
      y0: number,
      w0: number,
      a0: number,
      s0: number,
      x1: number,
      y1: number,
      w1: number,
      a1: number,
      s1: number,
    ) => {
      const l0x = x0 - w0 * 0.5
      const r0x = x0 + w0 * 0.5
      const l1x = x1 - w1 * 0.5
      const r1x = x1 + w1 * 0.5
      vert(l0x, y0, -1, a0, s0)
      vert(r0x, y0, 1, a0, s0)
      vert(l1x, y1, -1, a1, s1)
      vert(r0x, y0, 1, a0, s0)
      vert(r1x, y1, 1, a1, s1)
      vert(l1x, y1, -1, a1, s1)
    }
    for (let i = 0; i < live.length - 1; i++) {
      const a = live[i]
      const b = live[i + 1]
      if (Math.abs(b.y - a.y) < 0.15) continue
      quad(
        a.x,
        a.y,
        a.w * wMul,
        a.alpha * aMul,
        clamp(a.soft + softAdd, 0, 1),
        b.x,
        b.y,
        b.w * wMul,
        b.alpha * aMul,
        clamp(b.soft + softAdd, 0, 1),
      )
    }
    return n
  }

  const bindAttr = (loc: number, buffer: any, size: number, data: Float32Array) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0)
  }

  const born = Date.now()
  let raf = 0
  let running = true
  let risen = false
  const riseAt = Math.min(growMs * 0.22, 4800)

  const tick = () => {
    if (!running) return
    const now = Date.now()
    if (originY !== originTarget) {
      const d = originTarget - originY
      originY = Math.abs(d) < 0.5 ? originTarget : originY + d * 0.1
      stemH = Math.max(1, curlY - originY)
      placeEmber()
    }
    if (fade !== fadeTarget) {
      // 约 0.4s 到位，和原来 CSS 的过渡相当
      const d = fadeTarget - fade
      fade = Math.abs(d) < 0.004 ? fadeTarget : fade + d * 0.12
    }
    const growU = clamp((now - born) / growMs, 0, 1)
    if (!risen && now - born >= riseAt) {
      risen = true
      if (onRise) {
        try {
          onRise()
        } catch {
          // 标题回调失败不影响青烟
        }
      }
    }

    gl.viewport(0, 0, pixelW, pixelH)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (fade <= 0) {
      raf = setTimeout(tick, 16) as unknown as number
      return
    }
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(prog)
    gl.uniformMatrix4fv(uProj, false, proj)
    gl.uniform1f(uFade, fade)

    const pulse = 0.74 + Math.sin(now * 0.001) * 0.14
    for (let i = 0; i < 6; i++) emberA[i] = 0.55 * pulse
    gl.uniform3f(uColor, color.ember[0], color.ember[1], color.ember[2])
    gl.bindBuffer(gl.ARRAY_BUFFER, bufEmberPos)
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, bufEmberV)
    gl.enableVertexAttribArray(aV)
    gl.vertexAttribPointer(aV, 1, gl.FLOAT, false, 0, 0)
    bindAttr(aAlpha, bufEmberA, 1, emberA)
    gl.bindBuffer(gl.ARRAY_BUFFER, bufEmberS)
    gl.enableVertexAttribArray(aSoft)
    gl.vertexAttribPointer(aSoft, 1, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    gl.uniform3f(uColor, color.plume[0], color.plume[1], color.plume[2])
    for (let s = 0; s < strandN; s++) {
      fillStrand(s, now, growU)
      const liveStem = Math.max(2, Math.ceil(growU * (stemN - 1)) + 1)
      const count = growU >= 1 ? maxPts : liveStem
      const halo = writeStrip(points[s], count, 2.6, 0.22, 0.35)
      if (halo >= 6) {
        bindAttr(aPos, bufPos, 2, pos)
        bindAttr(aV, bufV, 1, across)
        bindAttr(aAlpha, bufAlpha, 1, alphas)
        bindAttr(aSoft, bufSoft, 1, softs)
        gl.drawArrays(gl.TRIANGLES, 0, halo)
      }
      const n = writeStrip(points[s], count, 1, 1, 0)
      if (n < 6) continue
      bindAttr(aPos, bufPos, 2, pos)
      bindAttr(aV, bufV, 1, across)
      bindAttr(aAlpha, bufAlpha, 1, alphas)
      bindAttr(aSoft, bufSoft, 1, softs)
      gl.drawArrays(gl.TRIANGLES, 0, n)
    }

    raf = setTimeout(tick, 16) as unknown as number
  }

  tick()

  return {
    setTint(next: SmokeTint) {
      useTint(next)
    },
    setSink(ratio: number) {
      const r = clamp(Number(ratio) || 0, -0.3, 0.12)
      originTarget = cssH * (0.5 - CONFIG.originYRatio - r)
    },
    setFade(alpha: number, instant?: boolean) {
      const a = clamp(Number(alpha), 0, 1)
      fadeTarget = isNaN(a) ? 1 : a
      if (instant) fade = fadeTarget
    },
    stop() {
      running = false
      if (raf) clearTimeout(raf)
      raf = 0
      try {
        gl.deleteBuffer(bufPos)
        gl.deleteBuffer(bufV)
        gl.deleteBuffer(bufAlpha)
        gl.deleteBuffer(bufSoft)
        gl.deleteBuffer(bufEmberPos)
        gl.deleteBuffer(bufEmberV)
        gl.deleteBuffer(bufEmberA)
        gl.deleteBuffer(bufEmberS)
        gl.deleteProgram(prog)
      } catch {
        // 真机上下文可能已丢
      }
      adapted.dispose()
    },
  }
}
