// 香案木鱼：WebGL1 程序化建模（照 UI 原型的 three.js 版本：椭球木身 + 唇沿 + 口缝 + 坐垫）。
// 不用 three / XR-Frame：微信 type=webgl 只有 WebGL1，和青烟一样直接写着色器。

import { adaptForMiniProgram } from './threeAdapt'

export type MuyuMaterial = 'zitan' | 'huali' | 'liuli' | 'yu'

export interface MuyuFishHandle {
  /** 敲一下：下压回弹 + 轻微晃动 */
  strike: () => void
  setMaterial: (m: MuyuMaterial) => void
  /** 拖动旋转（像素增量） */
  rotateBy: (dx: number, dy: number) => void
  /** 拖动中暂停自动摆动 */
  setDragging: (on: boolean) => void
  /** 暂停：停掉循环并清空画布（弹窗打开时用，画布是原生层，透明度压不住） */
  setPaused: (on: boolean) => void
  stop: () => void
}

interface MatPreset {
  color: number
  emissive: number
  spec: number
  shininess: number
  /** 0 无纹理，1 木纹，2 玉絮 */
  pattern: number
  /** < 1 时半透明（琉璃） */
  opacity: number
  /** 边缘透光强度 */
  rimGlow: number
}

// 颜色取自原型；WebGL1 没有透射，琉璃靠半透明 + 边缘光，玉靠絮状纹 + 柔光近似
export const MUYU_MATS: Record<MuyuMaterial, MatPreset & { name: string }> = {
  zitan: { name: '紫檀', color: 0x7a3a10, emissive: 0x1a0800, spec: 0.35, shininess: 36, pattern: 1, opacity: 1, rimGlow: 0.25 },
  huali: { name: '黄花梨', color: 0xb07434, emissive: 0x1f1000, spec: 0.3, shininess: 30, pattern: 1, opacity: 1, rimGlow: 0.25 },
  liuli: { name: '琉璃', color: 0x2a8fd6, emissive: 0x002244, spec: 1.1, shininess: 110, pattern: 0, opacity: 0.72, rimGlow: 1.2 },
  yu: { name: '玉', color: 0x6fc9a0, emissive: 0x05241a, spec: 0.55, shininess: 50, pattern: 2, opacity: 1, rimGlow: 0.7 },
}
const MATS = MUYU_MATS

const DARK_MOUTH = 0x120802
const CUSHION = 0x1c1611

const VERT = `
attribute vec3 aPos;
attribute vec3 aNor;
uniform mat4 uMvp;
uniform mat4 uModel;
uniform mat3 uNormal;
varying vec3 vN;
varying vec3 vW;
varying vec3 vL;
void main() {
  vL = aPos;
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = normalize(uNormal * aNor);
  gl_Position = uMvp * vec4(aPos, 1.0);
}
`

const FRAG = `
precision mediump float;
varying vec3 vN;
varying vec3 vW;
varying vec3 vL;
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform float uSpec;
uniform float uShine;
uniform float uGrain;
uniform float uOpacity;
uniform float uRimGlow;
uniform vec3 uEye;
uniform vec3 uKeyDir;
uniform vec3 uKeyCol;
uniform vec3 uRimDir;
uniform vec3 uRimCol;
uniform vec3 uFillDir;
uniform vec3 uFillCol;
uniform vec3 uAmb;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(uEye - vW);
  vec3 base = uColor;
  if (uGrain > 1.5) {
    // 玉：低频絮状明暗
    float c = sin(vL.x * 3.1 + sin(vL.y * 4.3) * 1.7) * sin(vL.z * 2.7 + sin(vL.x * 3.9) * 1.3);
    base *= mix(0.82, 1.12, c * 0.5 + 0.5);
  } else if (uGrain > 0.5) {
    float g = sin(vL.y * 34.0 + sin(vL.x * 2.3 + vL.z * 1.7) * 3.0 + sin(vL.z * 5.0) * 0.6);
    base *= mix(0.9, 1.05, g * 0.5 + 0.5);
  }
  vec3 diff = uAmb;
  diff += uKeyCol * max(dot(n, uKeyDir), 0.0);
  diff += uRimCol * max(dot(n, uRimDir), 0.0);
  diff += uFillCol * max(dot(n, uFillDir), 0.0);
  vec3 col = base * diff;
  float sk = pow(max(dot(n, normalize(uKeyDir + v)), 0.0), uShine);
  float sr = pow(max(dot(n, normalize(uRimDir + v)), 0.0), uShine);
  col += uSpec * (uKeyCol * sk + uRimCol * sr * 0.6);
  // 边缘一点暖光，像原型的 clearcoat
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += uRimGlow * fres * (uRimCol * 0.6 + base * 1.2);
  col += uEmissive * 0.6;
  col = col / (col + vec3(0.9)) * 1.5;
  // 半透明时边缘更实，中间更透
  float a = mix(uOpacity, 1.0, fres * (1.0 - uOpacity) * 1.6);
  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), clamp(a, 0.0, 1.0));
}
`

// ---------- 小矩阵库（列主序，和 WebGL 一致） ----------

type M4 = Float32Array

function m4(): M4 {
  const m = new Float32Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

function mul(a: M4, b: M4): M4 {
  const o = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
    }
  }
  return o
}

function perspective(fovDeg: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360)
  const m = new Float32Array(16)
  m[0] = f / aspect
  m[5] = f
  m[10] = (far + near) / (near - far)
  m[11] = -1
  m[14] = (2 * far * near) / (near - far)
  return m
}

function lookAt(eye: number[], target: number[]): M4 {
  let zx = eye[0] - target[0]
  let zy = eye[1] - target[1]
  let zz = eye[2] - target[2]
  let l = Math.hypot(zx, zy, zz)
  zx /= l
  zy /= l
  zz /= l
  // up = (0,1,0)
  let xx = zz
  let xy = 0
  let xz = -zx
  l = Math.hypot(xx, xy, xz)
  xx /= l
  xy /= l
  xz /= l
  const yx = zy * xz - zz * xy
  const yy = zz * xx - zx * xz
  const yz = zx * xy - zy * xx
  const m = m4()
  m[0] = xx
  m[4] = xy
  m[8] = xz
  m[1] = yx
  m[5] = yy
  m[9] = yz
  m[2] = zx
  m[6] = zy
  m[10] = zz
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2])
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2])
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2])
  return m
}

/** 平移 · 旋转（欧拉 XYZ，和 three 默认一致）· 缩放 */
function compose(p: number[], r: number[], s: number[]): M4 {
  const [cx, cy, cz] = [Math.cos(r[0]), Math.cos(r[1]), Math.cos(r[2])]
  const [sx, sy, sz] = [Math.sin(r[0]), Math.sin(r[1]), Math.sin(r[2])]
  // R = Rx * Ry * Rz
  const r00 = cy * cz
  const r01 = -cy * sz
  const r02 = sy
  const r10 = cx * sz + sx * sy * cz
  const r11 = cx * cz - sx * sy * sz
  const r12 = -sx * cy
  const r20 = sx * sz - cx * sy * cz
  const r21 = sx * cz + cx * sy * sz
  const r22 = cx * cy
  const m = new Float32Array(16)
  m[0] = r00 * s[0]
  m[1] = r10 * s[0]
  m[2] = r20 * s[0]
  m[4] = r01 * s[1]
  m[5] = r11 * s[1]
  m[6] = r21 * s[1]
  m[8] = r02 * s[2]
  m[9] = r12 * s[2]
  m[10] = r22 * s[2]
  m[12] = p[0]
  m[13] = p[1]
  m[14] = p[2]
  m[15] = 1
  return m
}

/** 模型矩阵左上 3x3 的逆转置（非等比缩放下法线才正确） */
function normalMat(m: M4): Float32Array {
  const a = m[0], b = m[4], c = m[8]
  const d = m[1], e = m[5], f = m[9]
  const g = m[2], h = m[6], i = m[10]
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C || 1
  const inv = 1 / det
  // 逆矩阵的转置 = 余子式矩阵 / det，按列主序写入
  return new Float32Array([
    A * inv, B * inv, C * inv,
    -(b * i - c * h) * inv, (a * i - c * g) * inv, -(a * h - b * g) * inv,
    (b * f - c * e) * inv, -(a * f - c * d) * inv, (a * e - b * d) * inv,
  ])
}

// ---------- 几何（参数照 three 对应几何体） ----------

interface Geo {
  pos: number[]
  nor: number[]
  idx: number[]
}

function grid(geo: Geo, rows: number, cols: number, base: number) {
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const a = base + y * (cols + 1) + x
      const b = a + cols + 1
      geo.idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
}

function sphere(r: number, ws: number, hs: number): Geo {
  const g: Geo = { pos: [], nor: [], idx: [] }
  for (let iy = 0; iy <= hs; iy++) {
    const v = iy / hs
    for (let ix = 0; ix <= ws; ix++) {
      const u = ix / ws
      const nx = -Math.cos(u * Math.PI * 2) * Math.sin(v * Math.PI)
      const ny = Math.cos(v * Math.PI)
      const nz = Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI)
      g.pos.push(nx * r, ny * r, nz * r)
      g.nor.push(nx, ny, nz)
    }
  }
  grid(g, hs, ws, 0)
  return g
}

/** 胶囊：沿 Y 轴，上下半球各偏移 len/2，中间两圈自然连成圆柱 */
function capsule(r: number, len: number, ws: number, hs: number): Geo {
  const g: Geo = { pos: [], nor: [], idx: [] }
  const half = Math.floor(hs / 2)
  let rows = 0
  const ring = (v: number, off: number) => {
    for (let ix = 0; ix <= ws; ix++) {
      const u = ix / ws
      const nx = -Math.cos(u * Math.PI * 2) * Math.sin(v)
      const ny = Math.cos(v)
      const nz = Math.sin(u * Math.PI * 2) * Math.sin(v)
      g.pos.push(nx * r, ny * r + off, nz * r)
      g.nor.push(nx, ny, nz)
    }
    rows += 1
  }
  for (let iy = 0; iy <= half; iy++) ring((iy / half) * (Math.PI / 2), len / 2)
  for (let iy = 0; iy <= half; iy++) ring(Math.PI / 2 + (iy / half) * (Math.PI / 2), -len / 2)
  grid(g, rows - 1, ws, 0)
  return g
}

function torus(R: number, r: number, radial: number, tubular: number): Geo {
  const g: Geo = { pos: [], nor: [], idx: [] }
  for (let j = 0; j <= radial; j++) {
    const v = (j / radial) * Math.PI * 2
    for (let i = 0; i <= tubular; i++) {
      const u = (i / tubular) * Math.PI * 2
      const x = (R + r * Math.cos(v)) * Math.cos(u)
      const y = (R + r * Math.cos(v)) * Math.sin(u)
      const z = r * Math.sin(v)
      g.pos.push(x, y, z)
      const nx = x - R * Math.cos(u)
      const ny = y - R * Math.sin(u)
      const l = Math.hypot(nx, ny, z) || 1
      g.nor.push(nx / l, ny / l, z / l)
    }
  }
  grid(g, radial, tubular, 0)
  return g
}

function cylinder(rt: number, rb: number, h: number, seg: number): Geo {
  const g: Geo = { pos: [], nor: [], idx: [] }
  const slope = (rb - rt) / h
  for (let y = 0; y <= 1; y++) {
    const rad = y * (rb - rt) + rt
    for (let x = 0; x <= seg; x++) {
      const t = (x / seg) * Math.PI * 2
      g.pos.push(rad * Math.sin(t), -y * h + h / 2, rad * Math.cos(t))
      const l = Math.hypot(1, slope)
      g.nor.push(Math.sin(t) / l, slope / l, Math.cos(t) / l)
    }
  }
  grid(g, 1, seg, 0)
  const cap = (top: boolean) => {
    const yy = top ? h / 2 : -h / 2
    const rad = top ? rt : rb
    const ny = top ? 1 : -1
    const center = g.pos.length / 3
    g.pos.push(0, yy, 0)
    g.nor.push(0, ny, 0)
    for (let x = 0; x <= seg; x++) {
      const t = (x / seg) * Math.PI * 2
      g.pos.push(rad * Math.sin(t), yy, rad * Math.cos(t))
      g.nor.push(0, ny, 0)
    }
    for (let x = 0; x < seg; x++) {
      if (top) g.idx.push(center, center + 1 + x, center + 2 + x)
      else g.idx.push(center, center + 2 + x, center + 1 + x)
    }
  }
  cap(true)
  cap(false)
  return g
}

function hexToLinear(hex: number): number[] {
  const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
  return c.map((v) => Math.pow(v / 255, 2.2))
}

function grabGl(el: any): any {
  const opts = { alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: false, depth: true }
  return el.getContext('webgl', opts) || el.getContext('experimental-webgl', opts) || el.getContext('webgl') || null
}

function compile(gl: any, type: number, src: string): any {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = String(gl.getShaderInfoLog(sh) || 'compile fail').replace(/\s+/g, ' ').slice(0, 80)
    gl.deleteShader(sh)
    throw new Error(log)
  }
  return sh
}

interface Part {
  buf: { pos: any; nor: any; idx: any; count: number }
  local: M4
  /** 'body' 跟随材质；其他固定颜色 */
  kind: 'body' | 'fixed'
  color?: number
}

export function startMuyuFish(
  canvas: any,
  cssW: number,
  cssH: number,
  dpr: number,
  material: MuyuMaterial = 'zitan',
): MuyuFishHandle {
  const ratio = Math.max(1, Math.min(dpr || 2, 2))
  const pixelW = Math.max(1, Math.round(cssW * ratio))
  const pixelH = Math.max(1, Math.round(cssH * ratio))
  const adapted = adaptForMiniProgram(canvas, { canvasWidth: pixelW, canvasHeight: pixelH })
  const gl = grabGl(adapted.canvas)
  if (!gl) throw new Error('webgl unavailable')

  const prog = gl.createProgram()
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(String(gl.getProgramInfoLog(prog) || 'link fail').slice(0, 80))
  }
  gl.useProgram(prog)
  const aPos = gl.getAttribLocation(prog, 'aPos')
  const aNor = gl.getAttribLocation(prog, 'aNor')
  const U: Record<string, any> = {}
  ;[
    'uMvp', 'uModel', 'uNormal', 'uColor', 'uEmissive', 'uSpec', 'uShine', 'uGrain', 'uOpacity', 'uRimGlow', 'uEye',
    'uKeyDir', 'uKeyCol', 'uRimDir', 'uRimCol', 'uFillDir', 'uFillCol', 'uAmb',
  ].forEach((n) => {
    U[n] = gl.getUniformLocation(prog, n)
  })

  const upload = (geo: Geo) => {
    const pos = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, pos)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo.pos), gl.STATIC_DRAW)
    const nor = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, nor)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo.nor), gl.STATIC_DRAW)
    const idx = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geo.idx), gl.STATIC_DRAW)
    return { pos, nor, idx, count: geo.idx.length }
  }

  // 尺寸、位置照原型
  const parts: Part[] = [
    { buf: upload(sphere(1, 72, 52)), local: compose([0, 0, 0], [0, 0, 0], [1.34, 0.78, 1.0]), kind: 'body' },
    {
      buf: upload(torus(0.92, 0.13, 24, 96)),
      local: compose([0, 0.22, 0], [Math.PI / 2, 0, 0], [1.3, 1.0, 1.0]),
      kind: 'body',
    },
    {
      buf: upload(capsule(0.11, 1.5, 16, 8)),
      // 原型 y=0.6 时口缝只在两端露头，俯视像两个黑点；抬到 0.66 露出完整一道
      local: compose([0, 0.66, 0.28], [0, 0.07, Math.PI / 2], [1, 1, 1]),
      kind: 'fixed',
      color: DARK_MOUTH,
    },
    {
      buf: upload(cylinder(1.16, 1.34, 0.26, 48)),
      local: compose([0, -0.78, 0], [0, 0, 0], [1, 1, 1]),
      kind: 'fixed',
      color: CUSHION,
    },
  ]

  // 斜上方俯视，能看到顶上的口缝和唇沿（原型是 0, 1.9, 7.9 近乎平视）
  const eye = [0, 4.6, 6.6]
  const view = lookAt(eye, [0, -0.3, 0])
  const proj = perspective(34, cssW / cssH, 0.1, 100)
  const vp = mul(proj, view)

  const norm = (v: number[]) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1
    return [v[0] / l, v[1] / l, v[2] / l]
  }
  const scaleCol = (hex: number, k: number) => hexToLinear(hex).map((c) => c * k)
  gl.uniform3fv(U.uEye, eye)
  gl.uniform3fv(U.uKeyDir, norm([-2.4, 4.2, 3.4]))
  gl.uniform3fv(U.uKeyCol, scaleCol(0xfff1d0, 0.9))
  gl.uniform3fv(U.uRimDir, norm([3.2, 1.2, -2.6]))
  gl.uniform3fv(U.uRimCol, scaleCol(0xf1c21b, 0.55))
  gl.uniform3fv(U.uFillDir, norm([2.6, -1.2, 2.2]))
  gl.uniform3fv(U.uFillCol, scaleCol(0xff832b, 0.25))
  gl.uniform3fv(U.uAmb, scaleCol(0xffe6bd, 0.22))

  let mat: MatPreset = MATS[material] || MATS.zitan
  let userYaw = 0
  let userPitch = 0
  let dragging = false
  let paused = false
  let swayT = 0
  let lastT = 0

  gl.viewport(0, 0, pixelW, pixelH)
  gl.enable(gl.DEPTH_TEST)
  gl.clearColor(0, 0, 0, 0)

  const t0 = Date.now()
  let strikeAt = -9999
  let running = true
  let timer: any = 0
  const raf: (cb: () => void) => any =
    canvas && typeof canvas.requestAnimationFrame === 'function'
      ? (cb) => canvas.requestAnimationFrame(cb)
      : (cb) => setTimeout(cb, 16)
  const caf = (id: any) => {
    if (canvas && typeof canvas.cancelAnimationFrame === 'function') canvas.cancelAnimationFrame(id)
    else clearTimeout(id)
  }

  const drawPart = (p: Part, group: M4) => {
    const model = mul(group, p.local)
    gl.uniformMatrix4fv(U.uModel, false, model)
    gl.uniformMatrix4fv(U.uMvp, false, mul(vp, model))
    gl.uniformMatrix3fv(U.uNormal, false, normalMat(model))
    if (p.kind === 'body') {
      gl.uniform3fv(U.uColor, hexToLinear(mat.color))
      gl.uniform3fv(U.uEmissive, hexToLinear(mat.emissive))
      gl.uniform1f(U.uSpec, mat.spec)
      gl.uniform1f(U.uShine, mat.shininess)
      gl.uniform1f(U.uGrain, mat.pattern)
      gl.uniform1f(U.uOpacity, mat.opacity)
      gl.uniform1f(U.uRimGlow, mat.rimGlow)
    } else {
      gl.uniform3fv(U.uColor, hexToLinear(p.color || 0))
      gl.uniform3fv(U.uEmissive, [0, 0, 0])
      gl.uniform1f(U.uSpec, 0.05)
      gl.uniform1f(U.uShine, 8)
      gl.uniform1f(U.uGrain, 0)
      gl.uniform1f(U.uOpacity, 1)
      gl.uniform1f(U.uRimGlow, 0)
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, p.buf.pos)
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, p.buf.nor)
    gl.enableVertexAttribArray(aNor)
    gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.buf.idx)
    gl.drawElements(gl.TRIANGLES, p.buf.count, gl.UNSIGNED_SHORT, 0)
  }

  const draw = () => {
    const t = (Date.now() - t0) / 1000
    const dt = Math.min(0.1, Math.max(0, t - lastT))
    lastT = t
    if (!dragging) swayT += dt
    const since = t - strikeAt
    const k = Math.max(0, 1 - since / 0.34)
    const press = Math.sin(k * Math.PI) * 0.085
    const s = 1.06 * (1 - press)
    // 原型是持续自转；这里在用户拖到的角度上轻轻左右摆，口缝大体朝前
    const sway = Math.sin(swayT * 0.5) * 0.22
    const group = compose(
      [0, -press * 0.5, 0],
      [userPitch, userYaw + sway, Math.sin(since * 14) * 0.02 * k],
      [s, s, s]
    )

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.disable(gl.BLEND)
    gl.depthMask(true)
    gl.disable(gl.CULL_FACE)
    const clear = mat.opacity >= 1
    // 先画不透明的部分；琉璃的木身/唇沿最后半透明叠上去
    for (let i = 0; i < parts.length; i++) {
      if (clear || parts[i].kind !== 'body') drawPart(parts[i], group)
    }
    if (!clear) {
      gl.enable(gl.BLEND)
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.enable(gl.CULL_FACE)
      gl.cullFace(gl.BACK)
      gl.depthMask(false)
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].kind === 'body') drawPart(parts[i], group)
      }
      gl.depthMask(true)
    }
  }

  const tick = () => {
    timer = 0
    if (!running || paused) return
    draw()
    timer = raf(tick)
  }
  tick()

  return {
    strike() {
      strikeAt = (Date.now() - t0) / 1000
    },
    setMaterial(m: MuyuMaterial) {
      mat = MATS[m] || MATS.zitan
    },
    rotateBy(dx: number, dy: number) {
      userYaw += dx * 0.008
      userPitch = Math.max(-0.35, Math.min(0.5, userPitch + dy * 0.005))
    },
    setDragging(on: boolean) {
      dragging = on
    },
    setPaused(on: boolean) {
      if (on === paused) return
      paused = on
      if (on) {
        if (timer) caf(timer)
        timer = 0
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      } else if (running && !timer) {
        lastT = (Date.now() - t0) / 1000
        tick()
      }
    },
    stop() {
      running = false
      if (timer) caf(timer)
      timer = 0
      try {
        parts.forEach((p) => {
          gl.deleteBuffer(p.buf.pos)
          gl.deleteBuffer(p.buf.nor)
          gl.deleteBuffer(p.buf.idx)
        })
        gl.deleteProgram(prog)
      } catch {
        // 真机上下文可能已丢
      }
      adapted.dispose()
    },
  }
}
