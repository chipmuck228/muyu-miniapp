// 立/改心愿 页面间共享的表单状态（心愿详情 → 立愿 Tab 修改时传递数据）
import { Wish } from './cloud'

export interface FormState {
  mode: 'create' | 'edit'
  wish?: Wish
}

function g(): any {
  return getApp().globalData
}

export function getFormState(): FormState | null {
  return g().wishForm || null
}

export function setFormState(s: FormState | null) {
  g().wishForm = s
}
