// 立 / 改心愿
import { PRESET_GOALS } from '../../utils/constants'
import { createWish, updateWish } from '../../utils/cloud'
import { getFormState, setFormState } from '../../utils/formState'
import { todayStr, fmtInt, concealTabBar } from '../../utils/util'

interface GoalOption {
  value: number
  label: string
}

Page({
  data: {
    statusBarHeight: 20,
    isEdit: false,
    formKey: '',
    name: '',
    goalOptions: [] as GoalOption[],
    selectedGoal: 0,
    customGoal: '',
    goalText: '0',
    deadline: '',
    minDate: '',
    submitting: false,
  },

  onLoad() {
    const app = getApp<IAppOption>()
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 20,
      goalOptions: PRESET_GOALS.map((v) => ({ value: v, label: fmtInt(v) })),
      minDate: todayStr(),
    })
  },

  onShow() {
    concealTabBar(this)
    if (this.data.submitting) this.setData({ submitting: false })
    const st = getFormState()
    const editing = !!(st && st.mode === 'edit' && st.wish)
    if (editing && st && st.wish) {
      const w = st.wish
      if (this.data.formKey !== w._id) {
        const hit = PRESET_GOALS.indexOf(w.goal)
        this.setData({
          isEdit: true,
          formKey: w._id,
          name: w.name,
          goalText: fmtInt(w.goal),
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

  resetForm() {
    this.setData({
      isEdit: false,
      formKey: '',
      name: '',
      goalText: '0',
      selectedGoal: 0,
      customGoal: '',
      deadline: '',
      submitting: false,
    })
  },

  onNameInput(e: any) {
    this.setData({ name: e.detail.value })
  },

  onPickPreset(e: any) {
    const value = Number(e.currentTarget.dataset.value)
    this.setData({
      selectedGoal: value,
      customGoal: '',
      goalText: fmtInt(value),
    })
  },

  onCustomInput(e: any) {
    const v = e.detail.value
    // 输入自定义目标：清除预设高亮
    const selectedGoal = v ? 0 : this.data.selectedGoal
    this.setData({
      customGoal: v,
      selectedGoal,
      goalText: v || (selectedGoal ? fmtInt(selectedGoal) : '0'),
    })
  },

  onPickDeadline(e: any) {
    this.setData({ deadline: e.detail.value })
  },

  clearDeadline() {
    this.setData({ deadline: '' })
  },

  doCancel() {
    this.clearState()
    const app = getApp<IAppOption>()
    app.globalData.homeEnterAnim = true
    concealTabBar(this)
    wx.switchTab({ url: '/pages/home/index' })
  },

  async doSubmit() {
    if (this.data.submitting) return
    const name = this.data.name.trim()
    if (!name) {
      wx.showToast({ title: '请填写心愿名称', icon: 'none' })
      return
    }
    if (name.length > 20) {
      wx.showToast({ title: '心愿名称最多 20 字', icon: 'none' })
      return
    }
    let goal = 0
    if (this.data.selectedGoal > 0) {
      goal = this.data.selectedGoal
    } else {
      goal = parseInt(this.data.customGoal, 10)
    }
    if (!goal || goal < 1 || !/^\d+$/.test(String(goal))) {
      wx.showToast({ title: '专注目标需为不小于 1 的整数', icon: 'none' })
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
        wx.showToast({ title: '已保存修改', icon: 'success' })
      } else {
        await createWish(name, goal, deadline || null)
        wx.showToast({ title: '心愿已立 · 完成后另有惊喜', icon: 'none' })
      }
      this.clearState()
      this.resetForm()
      setTimeout(() => {
        wx.switchTab({ url: '/pages/wishes/index' })
      }, 500)
    } catch (e: any) {
      wx.showToast({ title: (e && e.message) || '提交失败', icon: 'none' })
      this.setData({ submitting: false })
    } finally {
      wx.hideLoading()
    }
  },
})
