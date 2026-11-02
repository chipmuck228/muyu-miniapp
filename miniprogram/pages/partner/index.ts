import {
  channelHub,
  applyChannel,
  applyChannelUnbind,
  getChannelStats,
  generateChannelQR,
  activateChannel,
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
    if (row.status === 'authorized') return '解绑申请 · 已解绑'
    if (row.status === 'rejected') return '解绑申请 · 已拒绝'
    return '解绑申请'
  }
  if (row.status === 'pending') return '绑定申请 · 待授权'
  if (row.status === 'authorized') return '绑定申请 · 已授权'
  if (row.status === 'rejected') return '绑定申请 · 已拒绝'
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
    applications: [] as { _id: string; title: string; timeText: string; extraText: string }[],
    tenures: [] as { key: string; channelId: string; name: string; statusText: string; timeText: string; on: boolean; active: boolean }[],
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
      nickname: string
      avatarUrl: string
      avatarText: string
      timeText: string
      paidText: string
    }[],
    months: monthOptions(),
    monthIndex: 0,
    userQuery: '',
  },

  _name: '',
  _contact: '',
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

  onName(e: any) {
    this._name = String(e.detail.value || '')
  },

  onContact(e: any) {
    this._contact = String(e.detail.value || '')
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
      const selectedId = prevId && this._tenures.some((t) => t.channelId === prevId)
        ? prevId
        : hub.channelId || (this._tenures[0] && this._tenures[0].channelId) || ''
      let activateQrSrc = ''
      if (hub.needActivate && hub.activateFileID) {
        activateQrSrc = await resolveCloudFile(hub.activateFileID).catch(() => '')
      }
      this.setData({
        ready: true,
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
        applications: (hub.applications || []).map((a) => ({
          _id: a._id,
          title: appStatusText(a),
          timeText: a.createdAt ? '申请 ' + fmtDT(a.createdAt) : '',
          extraText: appExtra(a),
        })),
        tenures: this._tenures.map((t) => ({
          key: t.channelId + '-' + t.boundAt,
          channelId: t.channelId,
          name: t.name,
          statusText: t.status === 'active' ? '绑定中' : '已解绑',
          timeText: t.status === 'unbound' && t.unboundAt
            ? '解绑 ' + fmtDT(t.unboundAt)
            : t.boundAt
              ? '绑定 ' + fmtDT(t.boundAt)
              : '',
          on: t.channelId === selectedId,
          active: t.status === 'active',
        })),
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
    this.setData({
      selectedId: channelId,
      isActive,
      name: st.name || (tenure && tenure.name) || '渠道',
      userCount: st.userCount || 0,
      paidCount: st.paidCount || 0,
      totalText: fenText(st.totalCommission),
      pendingText: fenText(st.pendingCommission),
      users: (st.users || []).map((u) => {
        const label = (u.nickname || u.wechatId || '未填写').trim()
        return {
          id: u.id,
          wechatId: u.wechatId || '未填写',
          nickname: u.nickname || '',
          avatarUrl: u.avatarUrl || '',
          // 没头像时用昵称首字做占位，避免一片空圆圈
          avatarText: label.slice(0, 1).toUpperCase(),
          timeText: fmtDT(u.boundAt),
          paidText: u.paid ? '已付费' : '未付费',
        }
      }),
      tenures: this._tenures.map((t) => ({
        key: t.channelId + '-' + t.boundAt,
        channelId: t.channelId,
        name: t.name,
        statusText: t.status === 'active' ? '绑定中' : '已解绑',
        timeText: t.status === 'unbound' && t.unboundAt
          ? '解绑 ' + fmtDT(t.unboundAt)
          : t.boundAt
            ? '绑定 ' + fmtDT(t.boundAt)
            : '',
        on: t.channelId === channelId,
        active: t.status === 'active',
      })),
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

  async doApply() {
    const name = this._name.trim()
    if (!name) {
      wx.showToast({ title: '请填写名称', icon: 'none' })
      return
    }
    wx.showLoading({ title: '提交中', mask: true })
    try {
      await applyChannel(name, this._contact.trim())
      await this.boot()
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
