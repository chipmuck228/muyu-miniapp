import {
  channelAdminBootstrap,
  channelAdminList,
  channelAdminApps,
  channelAdminAuthorize,
  channelAdminReject,
  channelAdminUnbind,
  channelAdminApproveUnbind,
  channelAdminQr,
  channelAdminRefreshActivate,
  channelAdminWipe,
  AdminChannelRow,
  AdminAppRow,
} from '../../utils/cloud'
import { resolveCloudFile } from '../../utils/cloudFile'
import { concealTabBar } from '../../utils/util'

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

function statusText(row: AdminChannelRow): string {
  const mark = row.mark ? ' · ' + row.mark : ''
  if (row.status === 'active' && row.bound) return '绑定中' + mark
  if (row.status === 'pending' && row.authorized) {
    const exp = row.expireAt ? ' · 至 ' + fmtDT(row.expireAt) : ''
    return '待激活' + mark + exp
  }
  if (row.status === 'disabled') return '已停用'
  return '已解绑' + mark
}

function appLine(row: AdminAppRow): string {
  const mark = row.mark || ''
  const t = fmtDT(row.createdAt)
  return [mark, t].filter(Boolean).join(' · ')
}

Page({
  data: {
    statusBarHeight: 20,
    ready: false,
    bindApps: [] as (AdminAppRow & { line: string })[],
    unbindApps: [] as (AdminAppRow & { line: string })[],
    list: [] as { _id: string; name: string; statusText: string; canUnbind: boolean; pending: boolean }[],
    qrSrc: '',
    qrTitle: '',
    qrCode: '',
    qrExpire: '',
  },

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

  async boot() {
    try {
      await channelAdminBootstrap()
      await this.reload()
      this.setData({ ready: true })
    } catch (e: any) {
      wx.showToast({ title: (e && e.message) || '无管理权限', icon: 'none' })
      setTimeout(() => {
        wx.navigateBack({ delta: 1 })
      }, 800)
    }
  },

  async reload() {
    const [listR, appsR] = await Promise.all([channelAdminList(), channelAdminApps()])
    const bindApps = appsR.bindApps || appsR.apps || []
    const unbindApps = appsR.unbindApps || []
    this.setData({
      bindApps: bindApps.map((a) => ({ ...a, line: appLine(a) })),
      unbindApps: unbindApps.map((a) => ({ ...a, line: appLine(a) })),
      list: (listR.list || []).map((c) => ({
        _id: c._id,
        name: c.name,
        statusText: statusText(c),
        canUnbind: !!(c.bound || c.authorized),
        pending: c.status === 'pending' && !!c.authorized,
      })),
    })
  },

  async showQr(fileID: string, title: string, code: string, expireAt?: number) {
    const src = await resolveCloudFile(fileID)
    this.setData({
      qrSrc: src,
      qrTitle: title,
      qrCode: code,
      qrExpire: expireAt ? '有效至 ' + fmtDT(expireAt) : '',
    })
  },

  async authorize(e: any) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    wx.showLoading({ title: '授权中', mask: true })
    try {
      const r = await channelAdminAuthorize(id)
      await this.reload()
      await this.showQr(r.fileID, r.name, r.activateCode, r.expireAt)
      wx.showToast({ title: '已授权', icon: 'none' })
    } catch (e: any) {
      wx.showToast({ title: (e && e.message) || '授权失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  reject(e: any) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    wx.showModal({
      title: '驳回申请',
      content: '对方需重新提交后才能再处理。',
      confirmText: '驳回',
      confirmColor: '#c4a574',
      success: (res) => {
        if (res.confirm) this.doReject(id)
      },
    })
  },

  async doReject(id: string) {
    wx.showLoading({ title: '处理中', mask: true })
    try {
      await channelAdminReject(id)
      await this.reload()
    } catch (e: any) {
      wx.showToast({ title: (e && e.message) || '操作失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async viewQr(e: any) {
    const id = String(e.currentTarget.dataset.id || '')
    const title = String(e.currentTarget.dataset.name || '')
    if (!id) return
    wx.showLoading({ title: '读取中', mask: true })
    try {
      const r = await channelAdminQr(id)
      await this.showQr(r.fileID, title, r.activateCode, r.expireAt)
    } catch (e: any) {
      wx.showToast({ title: (e && e.message) || '读取失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  refreshActivate(e: any) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    wx.showModal({
      title: '重发激活码',
      content: '将生成新的激活码，并重新计算有效期。',
      confirmText: '重发',
      confirmColor: '#c4a574',
      success: (res) => {
        if (res.confirm) this.doRefresh(id)
      },
    })
  },

  async doRefresh(id: string) {
    wx.showLoading({ title: '生成中', mask: true })
    try {
      const r = await channelAdminRefreshActivate(id)
      await this.reload()
      await this.showQr(r.fileID, r.name, r.activateCode, r.expireAt)
    } catch (e: any) {
      wx.showToast({ title: (e && e.message) || '生成失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  unbind(e: any) {
    const id = String(e.currentTarget.dataset.id || '')
    const title = String(e.currentTarget.dataset.name || '')
    if (!id) return
    wx.showModal({
      title: '解绑渠道',
      content: '将解除「' + title + '」与当前微信的绑定。推广记录仍可被原渠道商查看。',
      confirmText: '解绑',
      confirmColor: '#c4a574',
      success: (res) => {
        if (res.confirm) this.doUnbind(id)
      },
    })
  },

  async doUnbind(id: string) {
    wx.showLoading({ title: '解绑中', mask: true })
    try {
      await channelAdminUnbind(id)
      this.setData({ qrSrc: '', qrTitle: '', qrCode: '', qrExpire: '' })
      await this.reload()
      wx.showToast({ title: '已解绑', icon: 'none' })
    } catch (e: any) {
      wx.showToast({ title: (e && e.message) || '解绑失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  approveUnbind(e: any) {
    const id = String(e.currentTarget.dataset.id || '')
    const title = String(e.currentTarget.dataset.name || '')
    if (!id) return
    wx.showModal({
      title: '确认解绑',
      content: '通过「' + title + '」的解绑申请。',
      confirmText: '解绑',
      confirmColor: '#c4a574',
      success: (res) => {
        if (res.confirm) this.doApproveUnbind(id)
      },
    })
  },

  async doApproveUnbind(id: string) {
    wx.showLoading({ title: '解绑中', mask: true })
    try {
      await channelAdminApproveUnbind(id)
      await this.reload()
      wx.showToast({ title: '已解绑', icon: 'none' })
    } catch (e: any) {
      wx.showToast({ title: (e && e.message) || '解绑失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  wipe() {
    wx.showModal({
      title: '清空渠道记录',
      content: '将删除全部渠道、申请、用户归因与佣金。管理员身份保留。',
      confirmText: '清空',
      confirmColor: '#c4a574',
      success: (res) => {
        if (res.confirm) this.doWipe()
      },
    })
  },

  async doWipe() {
    wx.showLoading({ title: '清空中', mask: true })
    try {
      await channelAdminWipe()
      this.setData({ qrSrc: '', qrTitle: '', qrCode: '', qrExpire: '' })
      await this.reload()
      wx.showToast({ title: '已清空', icon: 'none' })
    } catch (e: any) {
      wx.showToast({ title: (e && e.message) || '清空失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },
})
