// 香案青烟：WebGL1 软边丝带。上升全程随机扰动，顶部慢转张开后淡出。

import { adaptForMiniProgram } from './threeAdapt'

export const SMOKE_REV = 'v20260910v'

export interface VoidSmokeHandle {
  stop: () => void
}

export const CONFIG = {
  strands: 3,
  stemPts: 88,
  vortexPts: 32,
  pixelRatio: 1.5,
  riseSpeed: 0.3,
  originYRatio: 0.86,
  curlFromTop: 1 / 3,
  minWidth: 1.5,
  stemWidth: 16,
  vortexWidth: 22,
  bottomAlpha: 0.62,
  topAlpha: 0.34,
  holdMs: 400,
  scatterMs: 2800,
  vortexTurns: 0.6,
  vortexAmpRatio: 0.28,
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
varying float vAlpha;
varying float vSoft;
varying float vV;
void main() {
  float inner = mix(0.55, 0.28, clamp(vSoft, 0.0, 1.0));
  float edge = 1.0 - smoothstep(inner, 1.0, abs(vV));
  float a = vAlpha * edge;
  if (a < 0.012) discard;
  gl_FragColor = vec4(uColor, a);
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

export function startIncensePlume(canvas: any, cssW: number, cssH: number, dpr: number): VoidSmokeHandle {
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
  const proj = ortho(cssW, cssH)

  const originY = cssH * (0.5 - CONFIG.originYRatio)
  const screenTop = cssH * 0.5
  const curlY = screenTop - cssH * CONFIG.curlFromTop
  const stemH = Math.max(1, curlY - originY)
  const vortexAmp = cssW * CONFIG.vortexAmpRatio
  const growMs = (stemH / CONFIG.riseSpeed) * 16.67
  const vortexSpan = CONFIG.holdMs + CONFIG.scatterMs
  const spinSign = [1, -1, 1]
  const strandN = CONFIG.strands
  const stemN = CONFIG.stemPts
  const vortexN = CONFIG.vortexPts
  const maxPts = stemN + vortexN

  const strandPhase: number[] = []
  const pointSeed: number[][] = []
  for (let s = 0; s < strandN; s++) {
    strandPhase[s] = Math.random() * Math.PI * 2
    pointSeed[s] = new Array(maxPts)
    for (let i = 0; i < maxPts; i++) {
      pointSeed[s][i] = Math.random() * Math.PI * 2
    }
  }

  const points: RibbonPoint[][] = []
  for (let s = 0; s < strandN; s++) {
    points[s] = []
    for (let i = 0; i < maxPts; i++) {
      points[s][i] = { x: 0, y: originY, w: CONFIG.minWidth, alpha: 0, soft: 0 }
    }
  }

  const vertsPerStrand = maxPts * 2
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

  const drift = (t: number, seed: number, u: number): number => {
    const slow = Math.sin(t * 0.00011 + seed) * 0.5
    const mid = Math.sin(t * 0.00027 + seed * 1.63 + u * 2.8) * 0.35
    const fine = Math.sin(t * 0.00062 + seed * 2.17 + u * 7.4) * 0.15
    return slow + mid + fine
  }

  const fillStrand = (s: number, now: number, growU: number) => {
    const phase = strandPhase[s]
    const sway = Math.sin(now * 0.00013 + phase) * 3.4
    const liveStem = Math.max(2, Math.ceil(growU * (stemN - 1)) + 1)
    const showVortex = growU >= 1

    for (let i = 0; i < stemN; i++) {
      const p = points[s][i]
      if (i >= liveStem) {
        p.alpha = 0
        continue
      }
      const stemU = clamp((i / Math.max(1, liveStem - 1)) * growU, 0, 1)
      const amp = 1 + stemU * stemU * 13
      p.x = sway + drift(now, pointSeed[s][i], stemU) * amp
      p.y = originY + stemU * stemH
      p.w = CONFIG.minWidth + stemU * (CONFIG.stemWidth - CONFIG.minWidth)
      p.soft = 0.12 + stemU * 0.55
      p.alpha = CONFIG.bottomAlpha * (1 - stemU * 0.35)
      if (i === liveStem - 1 && growU < 1) p.alpha *= 0.55
    }

    for (let j = 0; j < vortexN; j++) {
      const p = points[s][stemN + j]
      if (!showVortex) {
        p.alpha = 0
        continue
      }
      const v = j / Math.max(1, vortexN - 1)
      const age = v * vortexSpan
      const seed = pointSeed[s][stemN + j]
      const n = drift(now, seed, 1) * 3.2
      if (age <= CONFIG.holdMs) {
        const holdT = age / CONFIG.holdMs
        p.x = sway + n * 0.4 + Math.cos(phase + holdT * 0.4) * (3 + holdT * 4)
        p.y = curlY + Math.sin(phase * 0.7 + holdT) * 2
        p.w = CONFIG.stemWidth
        p.soft = 0.6
        p.alpha = CONFIG.topAlpha
      } else {
        const scatterT = clamp((age - CONFIG.holdMs) / CONFIG.scatterMs, 0, 1)
        const ang = phase + spinSign[s] * scatterT * CONFIG.vortexTurns * Math.PI * 2 + now * 0.00032
        const rad = 10 + scatterT * vortexAmp
        p.x = sway + Math.cos(ang) * rad + n
        p.y = curlY + Math.sin(ang) * rad * 0.78 + n * 0.35
        p.w = CONFIG.stemWidth + scatterT * (CONFIG.vortexWidth - CONFIG.stemWidth)
        p.soft = 0.62 + scatterT * 0.38
        p.alpha = scatterT < 0.65 ? CONFIG.topAlpha : CONFIG.topAlpha * (1 - (scatterT - 0.65) / 0.35)
      }
    }
  }

  const writeStrip = (strand: RibbonPoint[], count: number): number => {
    if (count < 2) return 0
    let n = 0
    for (let i = 0; i < count; i++) {
      const p = strand[i]
      if (p.alpha <= 0.01) continue
      let px = 0
      let py = 0
      if (i === 0) {
        px = strand[1].x - p.x
        py = strand[1].y - p.y
      } else if (i === count - 1 || strand[i + 1].alpha <= 0.01) {
        px = p.x - strand[i - 1].x
        py = p.y - strand[i - 1].y
      } else {
        px = strand[i + 1].x - strand[i - 1].x
        py = strand[i + 1].y - strand[i - 1].y
      }
      const len = Math.sqrt(px * px + py * py) || 1
      const nx = -py / len
      const ny = px / len
      const hw = p.w * 0.5
      const i0 = n
      const i1 = n + 1
      pos[i0 * 2] = p.x + nx * hw
      pos[i0 * 2 + 1] = p.y + ny * hw
      pos[i1 * 2] = p.x - nx * hw
      pos[i1 * 2 + 1] = p.y - ny * hw
      across[i0] = 1
      across[i1] = -1
      alphas[i0] = p.alpha
      alphas[i1] = p.alpha
      softs[i0] = p.soft
      softs[i1] = p.soft
      n += 2
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

  const tick = () => {
    if (!running) return
    const now = Date.now()
    const growU = clamp((now - born) / growMs, 0, 1)

    gl.viewport(0, 0, pixelW, pixelH)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(prog)
    gl.uniformMatrix4fv(uProj, false, proj)

    const pulse = 0.74 + Math.sin(now * 0.001) * 0.14
    for (let i = 0; i < 6; i++) emberA[i] = 0.55 * pulse
    gl.uniform3f(uColor, 1, 0.36, 0.16)
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

    gl.uniform3f(uColor, 0.74, 0.86, 0.88)
    for (let s = 0; s < strandN; s++) {
      fillStrand(s, now, growU)
      const liveStem = Math.max(2, Math.ceil(growU * (stemN - 1)) + 1)
      const count = growU >= 1 ? maxPts : liveStem
      const n = writeStrip(points[s], count)
      if (n < 4) continue
      bindAttr(aPos, bufPos, 2, pos)
      bindAttr(aV, bufV, 1, across)
      bindAttr(aAlpha, bufAlpha, 1, alphas)
      bindAttr(aSoft, bufSoft, 1, softs)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, n)
    }

    raf = setTimeout(tick, 16) as unknown as number
  }

  tick()

  return {
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
