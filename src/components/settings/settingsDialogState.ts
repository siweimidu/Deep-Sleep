import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'

/** 设置弹窗的分组：通用设置 / 数据管理 / 第三方模型（API 地址与 Key） */
export type SettingsSection = 'general' | 'data' | 'endpoint'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 当前厂商没有可用 Key 时打开设置并直接落到「第三方模型」（填地址与 Key 的地方），返回是否已有 Key */
export const ensureApiKey = () => {
  // 判当前厂商有没有 Key，不能判「随便哪家有没有」：后者会让发送直接失败在缺 Key 上
  if (useSettings.getState().apiKey) {
    return true
  }
  openSettings('endpoint')
  return false
}
