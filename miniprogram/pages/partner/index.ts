import {
  channelHub,
  applyChannel,
  applyChannelUnbind,
  getChannelStats,
  generateChannelQR,
  activateChannel,
  updateChannelPhone,
  PartnerAppRow,
  PartnerTenure,
} from '../../utils/cloud'
import { resolveCloudFile } from '../../utils/cloudFile'
import { concealTabBar } from '../../utils/util'

function fenText(n: number): string {
  return (Math.max(0, n || 0) / 100).toFixed(2)
}

function pad(n: number) {
  return n < 10 ? '0' + n : '' + n
}

function fmtDT(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  if (isNaN(d.getTime())) return ''
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  )
}

function appStatusText(row: PartnerAppRow): string {
  if (row.type === 'unbind') {
    if (row.status === 'pending') return '解绑申请 · 待处理'
    if (row.status === 'authorized') return '已解绑'
    if (row.status === 'rejected') return '解绑申请 · 已拒绝'
    return '解绑申请'
  }
  if (row.status === 'pending') return '绑定申请 · 待授权'
  if (row.status === 'rejected') return '绑定申请 · 已拒绝'
  if (row.status === 'authorized') {
    // 授权之后看渠道现状，那才是这条申请的最终归宿
    if (row.channelStatus === 'active') return '绑定中'
    if (row.channelStatus === 'unbound') return '已解绑'
    return '绑定申请 · 已授权'
  }
  return '绑定申请'
}

function appExtra(row: PartnerAppRow): string {
  if (row.status === 'authorized' && row.handledAt) {
    return (row.type === 'unbind' ? '解绑 ' : '授权 ') + fmtDT(row.handledAt)
  }
  if (row.status === 'rejected' && row.handledAt) {
    return '拒绝 ' + fmtDT(row.handledAt)
  }
  return ''
}

const PHONE_RE = /^1[3-9]\d{9}$/

const WEEK_NAMES = ['一', '二', '三', '四', '五', '六', '日']

interface CalCell {
  key: string
  day: string
  count: number
  empty: boolean
}

// 把「每天新增人数」铺成月历网格：周一开头，不足一周的补空格
function buildCalendar(month: string, dailyNew: Record<string, number>) {
  if (!month) return { cells: [] as CalCell[], total: 0 }
  const y = parseInt(month.slice(0, 4), 10)
  const m = parseInt(month.slice(5, 7), 10)
  if (!y || !m) return { cells: [] as CalCell[], total: 0 }
  const first = new Date(y, m - 1, 1)
  const days = new Date(y, m, 0).getDate()
  const lead = (first.getDay() + 6) % 7
  const cells: CalCell[] = []
  for (let i = 0; i < lead; i++) cells.push({ key: 'e' + i, day: '', count: 0, empty: true })
  let total = 0
  for (let d = 1; d <= days; d++) {
    const k = month + '-' + pad(d)
    const c = dailyNew[k] || 0
    total += c
    cells.push({ key: k, day: String(d), count: c, empty: false })
  }
  return { cells, total }
}

function monthOptions(): { value: string; label: string }[] {
  const out = [{ value: '', label: '全部月份' }]
  const now = new Date()
  for (let i = 0; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const v = d.getFullYear() + '-' + pad(d.getMonth() + 1)
    out.push({ value: v, label: v })
  }
  return out
}

// 「我的推广」只列绑定中的渠道；已解绑的到「申请记录」里看状态
function mapTenures(all: PartnerTenure[], selectedId: string) {
  return all
    .filter((t) => t.status === 'active')
    .map((t) => ({
      key: t.channelId + '-' + t.boundAt,
      channelId: t.channelId,
      name: t.name,
      timeText: t.boundAt ? '绑定 ' + fmtDT(t.boundAt) : '',
      on: t.channelId === selectedId,
    }))
}

Page({
  data: {
    statusBarHeight: 20,
    ready: false,
    canApplyBind: false,
    pendingBind: false,
    canApplyUnbind: false,
    pendingUnbind: false,
    needActivate: false,
    activateName: '',
    activateCode: '',
    activateQrSrc: '',
    activateExpireText: '',
    activateExpired: false,
    applications: [] as {
      _id: string
      title: string
      statusText: string
      timeText: string
      extraText: string
      phone: string
      channelId: string
      canUnbind: boolean
    }[],
    tenures: [] as { key: string; channelId: string; name: string; timeText: string; on: boolean }[],
    selectedId: '',
    isActive: false,
    name: '',
    userCount: 0,
    paidCount: 0,
    totalText: '0.00',
    pendingText: '0.00',
    qrSrc: '',
    users: [] as {
      id: string
      wechatId: string
      timeText: string
      paidText: string
    }[],
    months: monthOptions(),
    monthIndex: 0,
    monthValue: '',
    userQuery: '',
    /** 当前渠道的结算联系手机号，用户可自助修改 */
    phone: '',
    weekNames: WEEK_NAMES,
    calCells: [] as CalCell[],
    calTotal: 0,
    settlementStatus: '' as '' | 'settled' | 'unsettled',
    settledText: '',
    truncated: false,
    usersTruncated: false,
    /** 是否有已解绑的历史渠道（有则提示去申请记录看历史佣金） */
    hasHistory: false,
    agreeOpen: false,
    agreeChecked: false,
    refreshing: false,
  },

  _name: '',
  _contact: '',
  _phone: '',
  _booting: false,
  _tenures: [] as PartnerTenure[],
  _qrChannelId: '',

  onLoad() {
    const app = getApp<IAppOption>()
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20 })
  },

  onShow() {
    this.boot()
  },

  goHall() {
    const app = getApp<IAppOption>()
    app.globalData.homeEnterAnim = true
    concealTabBar(this)
    wx.switchTab({ url: '/pages/home/index' })
  },

  // 页面本体 disableScroll、内容在 scroll-view 里，页面级下拉刷新不会触发，
  // 所以用 scroll-view 的 refresher 做下拉刷新
  async onRefresh() {
    try {
      await this.boot()
    } finally {
      this.setData({ refreshing: false })
    }
  },

  onName(e: any) {
    this._name = String(e.detail.value || '')
  },

  onContact(e: any) {
    this._contact = String(e.detail.value || '')
  },

  onPhone(e: any) {
    const v = String(e.detail.value || '')
    this._phone = v
    // 同步到 data：避免表单里其它 setData 重渲染时把输入框清空
    this.setData({ phone: v })
  },

  // 手机号只用于结算联系，按 openid 改自己的记录，不需要验证码或人工审核
  editPhone() {
    wx.showModal({
      title: '修改手机号',
      editable: true,
      placeholderText: '11 位手机号',
      content: this.data.phone || '',
      confirmText: '保存',
      confirmColor: '#c4a574',
      success: (res) => {
        if (!res.confirm) return
        const phone = String(res.content || '').trim()
        if (!PHONE_RE.test(phone)) {
          wx.showToast({ title: '请填写正确的 11 位手机号', icon: 'none' })
          return
        }
        wx.showLoading({ title: '保存中', mask: true })
        updateChannelPhone(phone)
          .then(() => {
            this.setData({ phone })
            wx.showToast({ title: '已更新', icon: 'none' })
          })
          .catch((e: any) => {
            wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' })
          })
          .finally(() => wx.hideLoading())
      },
    })
  },

  onUserQ(e: any) {
    this.setData({ userQuery: String(e.detail.value || '') })
  },

  async boot() {
    if (this._booting) return
    this._booting = true
    try {
      const hub = await channelHub()
      this._tenures = hub.tenures || []
      const prevId = this.data.selectedId
      // 「我的推广」只列绑定中的渠道，但已解绑渠道的历史佣金仍要能看：
      // 优先落在绑定中的渠道，只有在没有绑定中渠道时才回落到最近的已解绑渠道
      const activeOne = this._tenures.find((t) => t.status === 'active')
      const selectedId = prevId && this._tenures.some((t) => t.channelId === prevId)
        ? prevId
        : hub.channelId
          || (activeOne && activeOne.channelId)
          || (this._tenures[0] && this._tenures[0].channelId)
          || ''
      let activateQrSrc = ''
      if (hub.needActivate && hub.activateFileID) {
        activateQrSrc = await resolveCloudFile(hub.activateFileID).catch(() => '')
      }
      const appRows = (hub.applications || []).map((a) => ({
        _id: a._id,
        title: a.name || '渠道',
        statusText: appStatusText(a),
        timeText: a.createdAt ? '申请 ' + fmtDT(a.createdAt) : '',
        extraText: appExtra(a),
        phone: a.phone || '',
        channelId: a.channelId || '',
        // 只有"当前仍绑定中"的授权记录旁边才放解绑入口
        canUnbind: !!(hub.canApplyUnbind && a.type === 'bind' && a.status === 'authorized' && a.channelStatus === 'active'),
      }))
      this.setData({
        ready: true,
        phone: hub.phone || '',
        canApplyBind: !!hub.canApplyBind,
        pendingBind: !!hub.pendingBind,
        canApplyUnbind: !!hub.canApplyUnbind,
        pendingUnbind: !!hub.pendingUnbind,
        needActivate: !!hub.needActivate,
        activateName: hub.activateName || '',
        activateCode: hub.activateCode || '',
        activateQrSrc,
        activateExpireText: hub.activateExpireAt ? '有效至 ' + fmtDT(hub.activateExpireAt) : '',
        activateExpired: !!hub.activateExpired,
        applications: appRows,
        hasHistory: appRows.some((a) => a.channelStatus === 'unbound' && !!a.channelId),
        tenures: mapTenures(this._tenures, selectedId),
        selectedId,
        qrSrc: selectedId === prevId ? this.data.qrSrc : '',
      })
      if (selectedId !== prevId) this._qrChannelId = ''
      if (selectedId) await this.loadStats(selectedId)
    } catch (e: any) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    } finally {
      this._booting = false
    }
  },

  async loadStats(channelId: string) {
    const tenure = this._tenures.find((t) => t.channelId === channelId)
    const month = (this.data.months[this.data.monthIndex] || { value: '' }).value
    const st = await getChannelStats(channelId, {
      wechatId: String(this.data.userQuery || '').trim(),
      month,
    })
    const isActive = !!(tenure && tenure.status === 'active')
    const cal = buildCalendar(month, st.dailyNew || {})
    const settlement = st.settlement || null
    this.setData({
      selectedId: channelId,
      isActive,
      name: st.name || (tenure && tenure.name) || '渠道',
      userCount: st.userCount || 0,
      paidCount: st.paidCount || 0,
      totalText: fenText(st.totalCommission),
      pendingText: fenText(st.pendingCommission),
      monthValue: month,
      calCells: cal.cells,
      calTotal: cal.total,
      // 只有选定具体月份才有结算状态；「全部月份」不适合谈结算
      settlementStatus: month ? ((settlement && settlement.status) || 'unsettled') : '',
      settledText: settlement && settlement.settledAt ? fmtDT(settlement.settledAt) : '',
      truncated: !!st.truncated,
      usersTruncated: !!st.usersTruncated,
      // 只用识别号（openid 后 8 位）区分用户：不采集、不展示头像昵称
      users: (st.users || []).map((u) => ({
        id: u.id,
        wechatId: u.wechatId || '未填写',
        timeText: fmtDT(u.boundAt),
        paidText: u.paid ? '已付费' : '未付费',
      })),
      tenures: mapTenures(this._tenures, channelId),
    })
    if (isActive) {
      if (this._qrChannelId !== channelId) await this.makeQr(channelId)
    } else {
      this._qrChannelId = ''
      if (this.data.qrSrc) this.setData({ qrSrc: '' })
    }
  },

  async makeQr(channelId: string) {
    wx.showLoading({ title: '生成中', mask: true })
    try {
      const r = await generateChannelQR(channelId)
      const src = await resolveCloudFile(r.fileID)
      this._qrChannelId = channelId
      this.setData({ qrSrc: src })
    } catch (e: any) {
      wx.showToast({ title: (e && e.message) || '生成失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  pickTenure(e: any) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id || id === this.data.selectedId) return
    this._qrChannelId = ''
    this.setData({ qrSrc: '' })
    this.loadStats(id).catch((e: any) => {
      wx.showToast({ title: (e && e.message) || '读取失败', icon: 'none' })
    })
  },

  // 点申请记录查看该渠道的历史数据：解绑后佣金仍可查，只是不再显示推广码
  pickHistory(e: any) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id || id === this.data.selectedId) return
    this._qrChannelId = ''
    this.setData({ qrSrc: '' })
    this.loadStats(id).catch((err: any) => {
      wx.showToast({ title: (err && err.message) || '读取失败', icon: 'none' })
    })
  },

  async searchUsers() {
    if (!this.data.selectedId) return
    wx.showLoading({ title: '筛选中', mask: true })
    try {
      await this.loadStats(this.data.selectedId)
    } catch (e: any) {
      wx.showToast({ title: (e && e.message) || '筛选失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  onMonth(e: any) {
    const i = parseInt(e.detail.value, 10) || 0
    this.setData({ monthIndex: i })
    if (this.data.selectedId) this.searchUsers()
  },

  toggleAgree() {
    this.setData({ agreeOpen: !this.data.agreeOpen })
  },

  toggleAgreeCheck() {
    this.setData({ agreeChecked: !this.data.agreeChecked })
  },

  async doApply() {
    const name = this._name.trim()
    const phone = this._phone.trim()
    if (!name) {
      wx.showToast({ title: '请填写名称', icon: 'none' })
      return
    }
    if (!PHONE_RE.test(phone)) {
      wx.showToast({ title: '请填写正确的 11 位手机号', icon: 'none' })
      return
    }
    // 须知必须显式勾选：佣金规则、结算节奏、解绑后果都在里面，不能默认同意
    if (!this.data.agreeChecked) {
      wx.showToast({ title: '请先阅读并勾选渠道商须知', icon: 'none' })
      return
    }
    wx.showLoading({ title: '提交中', mask: true })
    try {
      await applyChannel(name, this._contact.trim(), phone)
      await this.boot()
      this.setData({ agreeChecked: false, agreeOpen: false })
      wx.showToast({ title: '已提交', icon: 'none' })
    } catch (e: any) {
      wx.showToast({ title: (e && e.message) || '提交失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async doActivate() {
    const code = String(this.data.activateCode || '').trim().toUpperCase()
    if (!code) {
      wx.showToast({ title: '激活码无效', icon: 'none' })
      return
    }
    if (this.data.activateExpired) {
      wx.showToast({ title: '激活码已过期', icon: 'none' })
      return
    }
    wx.showLoading({ title: '激活中', mask: true })
    try {
      await activateChannel(code)
      await this.boot()
      wx.showToast({ title: '已激活', icon: 'none' })
    } catch (e: any) {
      wx.showToast({ title: (e && e.message) || '激活失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  applyUnbind() {
    wx.showModal({
      title: '申请解绑',
      content: '提交后由管理员确认，方可解除当前渠道绑定。',
      confirmText: '提交',
      confirmColor: '#c4a574',
      success: (res) => {
        if (res.confirm) this.doApplyUnbind()
      },
    })
  },

  async doApplyUnbind() {
    wx.showLoading({ title: '提交中', mask: true })
    try {
      await applyChannelUnbind()
      await this.boot()
      wx.showToast({ title: '已提交', icon: 'none' })
    } catch (e: any) {
      wx.showToast({ title: (e && e.message) || '提交失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },
})
