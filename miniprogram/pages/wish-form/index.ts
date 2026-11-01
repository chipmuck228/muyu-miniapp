// 立 / 改心愿：普通页面，从香案的今日功课面板、心愿列表、心愿详情 navigateTo 进来，完成后返回来处
import { PRESET_GOALS } from '../../utils/constants'
import { createWish, removeWish, updateWish } from '../../utils/cloud'
import { getFormState, setFormState } from '../../utils/formState'
import { todayStr, fmtInt, offsetDate, fmtFullCN, dueText } from '../../utils/util'
import { applyLesson, loadLesson, RANDOM_LESSON } from '../../utils/lesson'
import { WISH_SUGGESTIONS } from '../../utils/wishIdeas'

interface GoalOption {
  value: number
  label: string
}

const NAME_MAX = 20
const GOAL_MAX = 999999
/** 期限的快捷选项：天数 */
const DUE_QUICK = [
  { days: 7, label: '七日' },
  { days: 30, label: '一月' },
  { days: 100, label: '百日' },
]

/** 「一秒一叩约 17 分钟 · 每日一百零八叩约 10 天」，让目标数字有个体感 */
function estimateOf(goal: number): string {
  if (!(goal > 0)) return ''
  const mins = goal / 60
  let pace = ''
  if (mins < 1) pace = '一秒一叩，不到一分钟'
  else if (mins < 60) pace = '一秒一叩，约 ' + Math.round(mins) + ' 分钟'
  else pace = '一秒一叩，约 ' + (Math.round((mins / 60) * 10) / 10) + ' 小时'
  const days = Math.ceil(goal / 108)
  return days > 1 ? pace + ' · 每日 108 叩，约 ' + fmtInt(days) + ' 天' : pace
}

function parseGoal(selected: number, custom: string): number {
  if (selected > 0) return selected
  const n = parseInt(custom, 10)
  return n > 0 ? n : 0
}

/** 从香案的今日功课面板进来：立好的愿直接设成今日功课 */
function cameFromAltar(): boolean {
  const pages = getCurrentPages()
  const prev = pages.length > 1 ? pages[pages.length - 2] : null
  return !!(prev && prev.route === 'pages/home/index')
}

Page({
  data: {
    statusBarHeight: 20,
    isEdit: false,
    formKey: '',
    name: '',
    nameLen: 0,
    nameMax: NAME_MAX,
    ideas: WISH_SUGGESTIONS,
    goalOptions: [] as GoalOption[],
    selectedGoal: 0,
    customGoal: '',
    estimate: '',
    deadline: '',
    deadlineText: '',
    deadlineDue: '',
    dueQuick: DUE_QUICK,
    minDate: '',
    submitting: false,
    canSubmit: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    const app = getApp<IAppOption>()
    let name = ''
    try {
      name = decodeURIComponent((options && options.name) || '').slice(0, NAME_MAX)
    } catch {
      name = ''
    }
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      goalOptions: PRESET_GOALS.map((v) => ({ value: v, label: fmtInt(v) })),
      minDate: todayStr(),
    })
    if (name) this.patchForm({ name })
  },

  onShow() {
    if (this.data.submitting) this.setData({ submitting: false })
    const st = getFormState()
    const editing = !!(st && st.mode === 'edit' && st.wish)
    if (editing && st && st.wish) {
      const w = st.wish
      if (this.data.formKey !== w._id) {
        const hit = PRESET_GOALS.indexOf(w.goal)
        this.setData({ isEdit: true, formKey: w._id })
        this.patchForm({
          name: w.name,
          selectedGoal: hit >= 0 ? w.goal : 0,
          customGoal: hit >= 0 ? '' : String(w.goal),
          deadline: w.deadline || '',
        })
      }
    } else if (!editing && this.data.isEdit) {
      // 编辑状态已退出（保存/取消），回到全新立愿
      this.resetForm()
    }
  },

  onUnload() {
    this.clearState()
  },

  clearState() {
    setFormState(null)
  },

  /** 改表单的几个字段，顺带把字数、估算、期限说法、能否提交一起算好 */
  patchForm(patch: Partial<{ name: string; selectedGoal: number; customGoal: string; deadline: string }>) {
    const next = {
      name: patch.name !== undefined ? patch.name : this.data.name,
      selectedGoal: patch.selectedGoal !== undefined ? patch.selectedGoal : this.data.selectedGoal,
      customGoal: patch.customGoal !== undefined ? patch.customGoal : this.data.customGoal,
      deadline: patch.deadline !== undefined ? patch.deadline : this.data.deadline,
    }
    const goal = parseGoal(next.selectedGoal, next.customGoal)
    const due = dueText(next.deadline)
    this.setData(
      Object.assign({}, next, {
        nameLen: next.name.length,
        estimate: estimateOf(goal),
        deadlineText: next.deadline ? fmtFullCN(next.deadline) : '',
        deadlineDue: due.text,
        canSubmit: !!next.name.trim() && goal >= 1 && goal <= GOAL_MAX,
      })
    )
  },

  resetForm() {
    this.setData({ isEdit: false, formKey: '', submitting: false })
    this.patchForm({ name: '', selectedGoal: 0, customGoal: '', deadline: '' })
  },

  onNameInput(e: any) {
    this.patchForm({ name: String(e.detail.value || '').slice(0, NAME_MAX) })
  },

  onIdea(e: any) {
    this.patchForm({ name: String(e.currentTarget.dataset.name || '') })
  },

  onPickPreset(e: any) {
    const value = Number(e.currentTarget.dataset.value)
    this.patchForm({ selectedGoal: value, customGoal: '' })
  },

  onCustomInput(e: any) {
    // 只留数字；输入自定义目标时清掉预设高亮
    const v = String(e.detail.value || '').replace(/\D/g, '').slice(0, 6)
    this.patchForm({ customGoal: v, selectedGoal: v ? 0 : this.data.selectedGoal })
    return v
  },

  onPickDeadline(e: any) {
    this.patchForm({ deadline: e.detail.value })
  },

  onDueQuick(e: any) {
    const days = Number(e.currentTarget.dataset.days) || 0
    if (days > 0) this.patchForm({ deadline: offsetDate(todayStr(), days) })
  },

  clearDeadline() {
    this.patchForm({ deadline: '' })
  },

  doCancel() {
    this.clearState()
    this.leave('/pages/home/index')
  },

  /** 返回来处；直接打开（页面栈只有自己）时回到兜底 Tab */
  leave(fallbackTab: string) {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    if (fallbackTab === '/pages/home/index') getApp<IAppOption>().globalData.homeEnterAnim = true
    wx.switchTab({ url: fallbackTab })
  },

  async doSubmit() {
    if (this.data.submitting) return
    const name = this.data.name.trim()
    if (!name) {
      wx.showToast({ title: '请填写心愿名称', icon: 'none' })
      return
    }
    if (name.length > NAME_MAX) {
      wx.showToast({ title: '心愿名称最多 20 字', icon: 'none' })
      return
    }
    const goal = parseGoal(this.data.selectedGoal, this.data.customGoal)
    if (!goal || goal < 1) {
      wx.showToast({ title: '选一个专注目标，或自定其数', icon: 'none' })
      return
    }
    if (goal > GOAL_MAX) {
      wx.showToast({ title: '目标最多 999,999', icon: 'none' })
      return
    }
    const deadline = this.data.deadline
    if (deadline && deadline < this.data.minDate) {
      wx.showToast({ title: '截止日期不能早于今天', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '正在提交', mask: true })
    try {
      if (this.data.isEdit) {
        await updateWish(this.data.formKey, name, goal, deadline || null)
        wx.hideLoading()
        wx.showToast({ title: '已保存修改', icon: 'success' })
      } else {
        const r = await createWish(name, goal, deadline || null)
        wx.hideLoading()
        if (cameFromAltar() && r && r.wishId) {
          // 在香案上点「立新愿」的人，是想马上为它敲
          applyLesson({ mode: 'wish', wishId: r.wishId, name })
          getApp<IAppOption>().globalData.newWishPicked = true
          wx.showToast({ title: '心愿已立 · 已设为今日功课', icon: 'none' })
        } else {
          wx.showToast({ title: '心愿已立 · 完成后另有惊喜', icon: 'none' })
        }
      }
      this.clearState()
      this.resetForm()
      setTimeout(() => {
        this.leave('/pages/wishes/index')
      }, 500)
    } catch (e: any) {
      wx.hideLoading()
      wx.showToast({ title: (e && e.message) || '提交失败', icon: 'none' })
      this.setData({ submitting: false })
    }
  },

  /** 改愿时可以删掉这个心愿 */
  doRemove() {
    const id = this.data.formKey
    if (!this.data.isEdit || !id || this.data.submitting) return
    wx.showModal({
      title: '删除这个心愿？',
      content: '心愿和它的记录会删掉，不能恢复；已敲的专注仍算在总数里。',
      confirmText: '删除',
      confirmColor: '#c0614a',
      cancelText: '留着',
      success: (r) => {
        if (!r.confirm) return
        this.setData({ submitting: true })
        wx.showLoading({ title: '正在删除', mask: true })
        removeWish(id)
          .then(() => {
            wx.hideLoading()
            const app = getApp<IAppOption>()
            const last = loadLesson()
            if (app.globalData.knockWishId === id || (last && last.wishId === id)) applyLesson(RANDOM_LESSON)
            wx.showToast({ title: '已删除', icon: 'none' })
            this.clearState()
            this.resetForm()
            // 详情页已经没有这个心愿了，回到列表
            setTimeout(() => {
              const pages = getCurrentPages()
              const prev = pages.length > 1 ? pages[pages.length - 2] : null
              if (prev && prev.route === 'pages/wish-detail/index') wx.navigateBack({ delta: 2 })
              else this.leave('/pages/wishes/index')
            }, 500)
          })
          .catch((err: any) => {
            wx.hideLoading()
            this.setData({ submitting: false })
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          })
      },
    })
  },
})
