// 香案 XR 场景：glTF 木鱼（青烟改由首页 canvas 绘制）
const MUYU_SCALE = 0.92
const MUYU_SCALE_KNOCK = 0.84

function scaleStr(s: number): string {
  return s + ' ' + s + ' ' + s
}

Component({
  properties: {
    pulsing: {
      type: Boolean,
      value: false,
    },
    skin: {
      type: String,
      value: 'wood',
    },
  },

  data: {
    muyuScaleStr: scaleStr(MUYU_SCALE),
    muyuAsset: 'muyu-wood',
  },

  observers: {
    pulsing(v: boolean) {
      this.setData({ muyuScaleStr: scaleStr(v ? MUYU_SCALE_KNOCK : MUYU_SCALE) })
    },
    skin() {
      this.setData({ muyuAsset: 'muyu-wood' })
    },
  },

  methods: {
    onSceneReady() {},
  },
})
