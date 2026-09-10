// 小程序 Canvas 上跑 three.js 所需的最小适配。
// three r163+ 按 WebGL2 写；微信 type=webgl 是 WebGL1，这里把缺口补上。

export interface AdaptResult {
  canvas: any
  miniProgramCanvas: any
  dispose: () => void
}

const TEXTURE_3D = 0x806f
const TEXTURE_2D_ARRAY = 0x8c1a
const MAX_SAMPLES = 0x8d57

const WEBGL2_NOOPS = [
  'texImage3D',
  'texSubImage3D',
  'texStorage2D',
  'texStorage3D',
  'blitFramebuffer',
  'renderbufferStorageMultisample',
  'drawBuffers',
  'clearBufferfv',
  'clearBufferiv',
  'clearBufferuiv',
  'fenceSync',
  'clientWaitSync',
  'deleteSync',
  'createSampler',
  'bindSampler',
  'deleteSampler',
  'samplerParameteri',
  'samplerParameterf',
  'beginQuery',
  'endQuery',
  'createQuery',
  'deleteQuery',
  'vertexAttribIPointer',
  'vertexAttribI4i',
  'vertexAttribI4ui',
  'uniform1ui',
  'uniform2ui',
  'uniform3ui',
  'uniform4ui',
]

function is3dTarget(gl: any, target: number): boolean {
  return target === TEXTURE_3D || target === TEXTURE_2D_ARRAY || target === gl.TEXTURE_3D || target === gl.TEXTURE_2D_ARRAY
}

const GL_ARRAY_BUFFER = 0x8892
const GL_ELEMENT_ARRAY_BUFFER = 0x8893

function createSoftVao(gl: any) {
  const nativeBindBuffer = typeof gl.bindBuffer === 'function' ? gl.bindBuffer.bind(gl) : null
  const nativeVap = typeof gl.vertexAttribPointer === 'function' ? gl.vertexAttribPointer.bind(gl) : null
  const nativeEnable = typeof gl.enableVertexAttribArray === 'function' ? gl.enableVertexAttribArray.bind(gl) : null
  const nativeDisable = typeof gl.disableVertexAttribArray === 'function' ? gl.disableVertexAttribArray.bind(gl) : null

  let arrayBuf: any = null
  let seq = 1
  const def = { attribs: {} as Record<string, any>, elementBuf: null as any, _vao: true }
  let current = def

  const replay = (state: any) => {
    if (!state) return
    for (let i = 0; i < 16; i++) {
      if (nativeDisable) nativeDisable(i)
    }
    if (nativeBindBuffer) nativeBindBuffer(GL_ELEMENT_ARRAY_BUFFER, state.elementBuf || null)
    const attribs = state.attribs || {}
    Object.keys(attribs).forEach((key) => {
      const a = attribs[key]
      const index = Number(key)
      if (a && a.buffer != null && nativeBindBuffer && nativeVap) {
        nativeBindBuffer(GL_ARRAY_BUFFER, a.buffer)
        nativeVap(index, a.size, a.type, a.normalized, a.stride, a.offset)
      }
      if (a && a.enabled && nativeEnable) nativeEnable(index)
    })
  }

  return {
    createVertexArray() {
      return { attribs: {}, elementBuf: null, _vao: true, id: seq++ }
    },
    bindVertexArray(vao: any) {
      current = vao || def
      replay(current)
    },
    deleteVertexArray() {},
    isVertexArray(v: any) {
      return !!(v && v._vao)
    },
    bindBuffer(target: number, buffer: any) {
      if (target === GL_ARRAY_BUFFER) arrayBuf = buffer
      if (target === GL_ELEMENT_ARRAY_BUFFER) {
        current.elementBuf = buffer
      }
      if (nativeBindBuffer) return nativeBindBuffer(target, buffer)
    },
    vertexAttribPointer(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number) {
      current.attribs[index] = {
        buffer: arrayBuf,
        size,
        type,
        normalized,
        stride,
        offset,
        enabled: current.attribs[index] ? current.attribs[index].enabled : false,
      }
      if (nativeVap) return nativeVap(index, size, type, normalized, stride, offset)
    },
    enableVertexAttribArray(index: number) {
      if (!current.attribs[index]) current.attribs[index] = { enabled: true }
      else current.attribs[index].enabled = true
      if (nativeEnable) return nativeEnable(index)
    },
    disableVertexAttribArray(index: number) {
      if (current.attribs[index]) current.attribs[index].enabled = false
      if (nativeDisable) return nativeDisable(index)
    },
  }
}

/** three r163+ 假定 WebGL2；微信 type=webgl 只有 WebGL1。 */
export function patchWeChatGL(gl: any): any {
  if (!gl) return gl

  const noop = function () {}
  const precision = { rangeMin: 127, rangeMax: 127, precision: 23 }
  const vao = createSoftVao(gl)

  if (typeof Proxy !== 'function') return gl

  return new Proxy(gl, {
    get(target, prop) {
      if (prop === 'createVertexArray') return vao.createVertexArray
      if (prop === 'bindVertexArray') return vao.bindVertexArray
      if (prop === 'deleteVertexArray') return vao.deleteVertexArray
      if (prop === 'isVertexArray') return vao.isVertexArray
      if (prop === 'bindBuffer') return vao.bindBuffer
      if (prop === 'vertexAttribPointer') return vao.vertexAttribPointer
      if (prop === 'enableVertexAttribArray') return vao.enableVertexAttribArray
      if (prop === 'disableVertexAttribArray') return vao.disableVertexAttribArray
      if (typeof prop === 'string' && WEBGL2_NOOPS.indexOf(prop) >= 0 && typeof target[prop] !== 'function') {
        return noop
      }
      if (prop === 'vertexAttribDivisor' && typeof target.vertexAttribDivisor !== 'function') return noop
      if (prop === 'drawArraysInstanced' && typeof target.drawArraysInstanced !== 'function') return noop
      if (prop === 'drawElementsInstanced' && typeof target.drawElementsInstanced !== 'function') return noop
      if (prop === 'TEXTURE_3D' && target.TEXTURE_3D == null) return TEXTURE_3D
      if (prop === 'TEXTURE_2D_ARRAY' && target.TEXTURE_2D_ARRAY == null) return TEXTURE_2D_ARRAY
      if (prop === 'MAX_SAMPLES' && target.MAX_SAMPLES == null) return MAX_SAMPLES
      if (prop === 'isContextLost' && typeof target.isContextLost !== 'function') {
        return function () {
          return false
        }
      }
      if (prop === 'bindTexture') {
        const native = target.bindTexture
        return function (type: number, tex: any) {
          if (is3dTarget(target, type)) return
          if (typeof native === 'function') return native.call(target, type, tex)
        }
      }
      if (prop === 'texParameteri') {
        const native = target.texParameteri
        return function (type: number, pname: number, param: number) {
          if (is3dTarget(target, type)) return
          if (typeof native === 'function') return native.call(target, type, pname, param)
        }
      }
      if (prop === 'getParameter') {
        const native = target.getParameter
        return function (pname: number) {
          let v: any
          try {
            v = typeof native === 'function' ? native.call(target, pname) : undefined
          } catch {
            v = undefined
          }
          if (pname === 0x0ba2 || pname === 0x0c10 || pname === target.VIEWPORT || pname === target.SCISSOR_BOX) {
            if (v && typeof v.length === 'number' && v.length >= 4) return v
            const w = target.drawingBufferWidth || (target.canvas && target.canvas.width) || 1
            const h = target.drawingBufferHeight || (target.canvas && target.canvas.height) || 1
            return typeof Int32Array !== 'undefined' ? new Int32Array([0, 0, w, h]) : [0, 0, w, h]
          }
          if (v !== null && v !== undefined && v !== 0) return v
          if (pname === MAX_SAMPLES || pname === target.MAX_SAMPLES) return 0
          if (pname === 0x8869 || pname === target.MAX_VERTEX_ATTRIBS) return 16
          if (pname === 0x8872 || pname === target.MAX_TEXTURE_IMAGE_UNITS) return 8
          if (pname === 0x0d33 || pname === target.MAX_TEXTURE_SIZE) return 2048
          if (pname === 0x851c || pname === target.MAX_CUBE_MAP_TEXTURE_SIZE) return 2048
          if (pname === 0x8b4c || pname === target.MAX_VERTEX_TEXTURE_IMAGE_UNITS) return 0
          if (pname === 0x8dfb || pname === target.MAX_VERTEX_UNIFORM_VECTORS) return 128
          if (pname === 0x8dfc || pname === target.MAX_VARYING_VECTORS) return 8
          if (pname === 0x8dfd || pname === target.MAX_FRAGMENT_UNIFORM_VECTORS) return 64
          if (v === 0) return 0
          return null
        }
      }
      if (prop === 'getShaderPrecisionFormat') {
        const native = target.getShaderPrecisionFormat
        return function (sh: number, prec: number) {
          try {
            const r = typeof native === 'function' ? native.call(target, sh, prec) : null
            if (r && typeof r.precision === 'number') return r
          } catch {
            // ignore
          }
          return precision
        }
      }
      const v = target[prop]
      if (typeof v === 'function') return v.bind(target)
      return v
    },
  })
}

export function adaptForMiniProgram(canvas: any, options?: { canvasWidth?: number; canvasHeight?: number }): AdaptResult {
  if (!canvas) {
    throw new Error('Canvas is required')
  }

  if (!canvas.style) canvas.style = {}
  if (typeof canvas.addEventListener !== 'function') {
    canvas.addEventListener = function () {}
    canvas.removeEventListener = function () {}
  }
  if (typeof canvas.getBoundingClientRect !== 'function') {
    canvas.getBoundingClientRect = function () {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: canvas.height || 1,
        right: canvas.width || 1,
        width: canvas.width || 1,
        height: canvas.height || 1,
      }
    }
  }
  if (!canvas.ownerDocument) canvas.ownerDocument = { hidden: false }
  if (typeof canvas.clientWidth !== 'number') {
    Object.defineProperty(canvas, 'clientWidth', {
      configurable: true,
      get() {
        return canvas.width || 1
      },
    })
    Object.defineProperty(canvas, 'clientHeight', {
      configurable: true,
      get() {
        return canvas.height || 1
      },
    })
  }

  if (options && options.canvasWidth) canvas.width = options.canvasWidth
  if (options && options.canvasHeight) canvas.height = options.canvasHeight

  return {
    canvas,
    miniProgramCanvas: canvas,
    dispose() {},
  }
}
