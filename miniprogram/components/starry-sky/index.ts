// 主页星夜背景：纯 DOM + CSS 动画实现
//
// 为什么不用 canvas：canvas 是原生组件，在部分安卓机型 / 基础库上同层渲染
// 会失效，被系统强制提到最上层，任何 z-index 都压不住。表现出来就是
// "菜单看不见，但点在原位置还有效"。改成普通 view 后层级由 DOM + CSS 决定，
// 不可能再遮挡任何界面元素。
//
// 星尘布局在 attached 时算一次，之后全靠 CSS 动画跑，不再占用 JS 线程。
import { winInfo } from '../../utils/util'

interface Dot {
  k: number
  x: number
  y: number
  /** 直径 rpx */
  s: number
  c: string
  /** 呼吸周期 s */
  dur: number
  d: number
}

interface SkyPalette {
  /** 星尘颜色（rgba，整体压淡以免糊住前景） */
  colors: string[]
  /** 星云光斑颜色 */
  nebula: string
}

const PALETTES: { [k: string]: SkyPalette } = {
  // 翡翠极光
  emerald: {
    nebula: 'rgba(119,195,156,0.10)',
    colors: [
      'rgba(119,195,156,0.55)',
      'rgba(85,171,165,0.5)',
      'rgba(68,168,114,0.45)',
      'rgba(33,89,100,0.45)',
      'rgba(205,237,174,0.35)',
    ],
  },
  // 梵高星夜 1889：深蓝 + 金黄
  starry: {
    nebula: 'rgba(65,130,184,0.12)',
    colors: [
      'rgba(40,89,148,0.55)',
      'rgba(65,130,184,0.5)',
      'rgba(107,174,214,0.45)',
      'rgba(247,208,70,0.4)',
      'rgba(255,238,219,0.35)',
    ],
  },
  // 猎户星云
  nebula: {
    nebula: 'rgba(153,55,122,0.12)',
    colors: [
      'rgba(108,45,122,0.5)',
      'rgba(153,55,122,0.48)',
      'rgba(200,90,128,0.45)',
      'rgba(162,136,227,0.4)',
      'rgba(252,246,189,0.35)',
    ],
  },
  // 晨：暖金
  dawn: {
    nebula: 'rgba(200,138,74,0.10)',
    colors: [
      'rgba(232,201,138,0.55)',
      'rgba(200,138,74,0.5)',
      'rgba(245,226,192,0.4)',
      'rgba(217,176,106,0.4)',
      'rgba(255,217,138,0.35)',
    ],
  },
  // 墨：骨白
  ink: {
    nebula: 'rgba(206,202,192,0.08)',
    colors: [
      'rgba(216,212,200,0.45)',
      'rgba(168,164,154,0.42)',
      'rgba(234,231,222,0.35)',
      'rgba(140,136,126,0.38)',
      'rgba(192,188,176,0.32)',
    ],
  },
  // 霞：落日霞红
  dusk: {
    nebula: 'rgba(224,120,74,0.11)',
    colors: [
      'rgba(240,160,112,0.52)',
      'rgba(224,120,74,0.48)',
      'rgba(255,210,176,0.4)',
      'rgba(192,90,58,0.42)',
      'rgba(245,188,148,0.35)',
    ],
  },
}

/** 主题 → 默认调色盘 */
const THEME_PALETTE: { [k: string]: string } = {
  dawn: 'dawn',
  night: 'starry',
  ink: 'ink',
  dusk: 'dusk',
}

function paletteOf(theme: string, want: string): SkyPalette {
  const key = want && want !== 'auto' ? want : THEME_PALETTE[theme] || 'dawn'
  return PALETTES[key] || PALETTES.dawn
}

function makeLayer(n: number, pal: SkyPalette, sizeBase: number, sizeSpan: number): Dot[] {
  const out: Dot[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      k: i,
      x: Math.round(Math.random() * 1000) / 10,
      y: Math.round(Math.random() * 1000) / 10,
      s: Math.round((sizeBase + Math.random() * sizeSpan) * 10) / 10,
      c: pal.colors[Math.floor(Math.random() * pal.colors.length)],
      dur: Math.round((5 + Math.random() * 6) * 10) / 10,
      d: -Math.round(Math.random() * 90) / 10,
    })
  }
  return out
}

/** 每层光点数：小屏少一些，避免糊成一片 */
function dotsPerLayer(w: number): number {
  if (w <= 340) return 20
  if (w <= 400) return 24
  return 28
}

Component({
  properties: {
    /** 跟随香案主题换色 */
    theme: {
      type: String,
      value: 'dawn',
    },
    /** auto 跟随主题；也可指定 emerald / starry / nebula / dawn / ink / dusk */
    palette: {
      type: String,
      value: 'auto',
    },
    /** 页面可见时才跑动画 */
    active: {
      type: Boolean,
      value: true,
    },
  },

  data: {
    layerA: [] as Dot[],
    layerB: [] as Dot[],
    layerC: [] as Dot[],
    nebula: '',
  },

  observers: {
    'theme, palette'(theme: string, palette: string) {
      this.rebuild(paletteOf(theme, palette))
    },
  },

  lifetimes: {
    attached() {
      this.rebuild(paletteOf(this.data.theme, this.data.palette))
    },
  },

  methods: {
    rebuild(pal: SkyPalette) {
      const w = Number((winInfo() || {}).windowWidth) || 375
      const n = dotsPerLayer(w)
      this.setData({
        // 三层不同大小与速度，拉开景深（尺寸单位 px，2~6px 才看得见）
        layerA: makeLayer(n, pal, 3.4, 2.4),
        layerB: makeLayer(n, pal, 2.4, 1.6),
        layerC: makeLayer(n + 4, pal, 1.6, 1.2),
        nebula: pal.nebula,
      })
    },
  },
})
