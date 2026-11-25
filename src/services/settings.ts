import { create } from 'zustand'
import { android } from '../app/android.js'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'
import { setOriginOverride } from './api/originStore.js'
import { normalizeOrigin } from './api/endpoint.js'
import { DEEPSEEK_BASE_URL, findProvider } from './api/providers.js'

export type Locale = 'zh-CN' | 'en-US'
export type LocalePreference = Locale | 'system'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  locale: Locale
  localePreference: LocalePreference
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  autoRead: boolean
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  fontSize: number | null
  foldThinking: boolean
  pinnedSessions: string[]
  /** 用户上传的头像（圆形裁切后的 data URL），为空时显示默认人形图标 */
  avatar: string | null
  /** 自定义账户名称；null 表示用默认的 API Key */
  accountName: string | null
  /** 自定义 API 地址（只存 origin）；null 表示用内置地址 */
  apiBaseUrl: string | null
  /** 当前厂商预设 id（见 api/providers.ts）；'deepseek' 表示官方 */
  providerId: string
  /** 完整 OpenAI 兼容 base url（带路径），默认 DeepSeek 官方 */
  providerBaseUrl: string
  /** 选中的模型名；null 表示用应用自带的模型 */
  providerModel: string | null
  /** 已保存的模型 chips */
  savedModels: string[]
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  autoRead: 'replica:auto-read',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  fontSize: 'replica:font-size',
  foldThinking: 'replica:fold-thinking',
  pinnedSessions: 'replica:pinned-sessions',
  avatar: 'deepsleep:avatar',
  accountName: 'deepsleep:account-name',
  apiBaseUrl: 'replica:api-base-url',
  providerId: 'replica:provider-id',
  providerBaseUrl: 'replica:provider-base-url',
  providerModel: 'replica:provider-model',
  savedModels: 'replica:provider-models',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocalePreference = (): LocalePreference => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return 'system'
}

const resolveLocale = (preference: LocalePreference): Locale =>
  preference === 'system' ? (isChineseBrowser() ? 'zh-CN' : 'en-US') : preference

const initialFontSize = () => {
  const saved = read(KEYS.fontSize)
  if (saved === 'system') {
    return null
  }
  return saved !== null && /^[0-6]$/.test(saved) ? Number(saved) : 3
}

const initialPinnedSessions = (): string[] => {
  try {
    const value: unknown = JSON.parse(read(KEYS.pinnedSessions) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const initialApiBaseUrl = (): string | null => normalizeOrigin(read(KEYS.apiBaseUrl))

const initialSavedModels = (): string[] => {
  try {
    const value: unknown = JSON.parse(read(KEYS.savedModels) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/**
 * 存下来的厂商 id 可能已经不存在（预设改名或拆档，例如 agnes 拆成国内外两条）。
 * 认不出来就干脆退回官方：否则界面上会直接把原始 id 当厂商名显示出来。
 */
const initialProvider = (): { providerId: string; providerBaseUrl: string } => {
  const preset = findProvider(read(KEYS.providerId) ?? '')
  if (!preset) {
    return { providerId: 'deepseek', providerBaseUrl: DEEPSEEK_BASE_URL }
  }
  return { providerId: preset.id, providerBaseUrl: read(KEYS.providerBaseUrl) ?? preset.baseUrl }
}

export const useSettings = create<Settings>(() => ({
  apiKey: android ? android.readApiKey() : read(KEYS.apiKey),
  locale: resolveLocale(initialLocalePreference()),
  localePreference: initialLocalePreference(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  autoRead: read(KEYS.autoRead) === 'true',
  thinking: read(KEYS.thinking) === 'true',
  search: (read(KEYS.search) ?? (android ? 'true' : 'false')) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  fontSize: initialFontSize(),
  foldThinking: read(KEYS.foldThinking) !== 'false',
  pinnedSessions: initialPinnedSessions(),
  avatar: read(KEYS.avatar),
  accountName: read(KEYS.accountName),
  apiBaseUrl: initialApiBaseUrl(),
  ...initialProvider(),
  providerModel: read(KEYS.providerModel),
  savedModels: initialSavedModels(),
}))

// 启动时把已保存的自定义地址同步给客户端：store 初始化后立刻生效，避免第一次请求走错地址
setOriginOverride(useSettings.getState().apiBaseUrl)

export const setAccountName = (accountName: string | null) => {
  const value = accountName?.trim() ? accountName.trim().slice(0, 20) : null
  write(KEYS.accountName, value)
  useSettings.setState({ accountName: value })
}

export const setAvatar = (avatar: string | null) => {
  // 头像只在本地保存，超出配额时保留上一次成功保存的图。
  write(KEYS.avatar, avatar)
  useSettings.setState({ avatar: read(KEYS.avatar) })
}

export const setPinnedSessions = (pinnedSessions: string[]) => {
  write(KEYS.pinnedSessions, JSON.stringify(pinnedSessions))
  useSettings.setState({ pinnedSessions })
}
export const setLocale = (localePreference: LocalePreference) => {
  write(KEYS.locale, localePreference)
  useSettings.setState({ localePreference, locale: resolveLocale(localePreference) })
}

export const setFontSize = (fontSize: number | null) => {
  write(KEYS.fontSize, fontSize?.toString() ?? 'system')
  useSettings.setState({ fontSize })
}

export const setFoldThinking = (foldThinking: boolean) => {
  write(KEYS.foldThinking, String(foldThinking))
  useSettings.setState({ foldThinking })
}
export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setAutoRead = (autoRead: boolean) => {
  write(KEYS.autoRead, String(autoRead))
  useSettings.setState({ autoRead })
}

export const setApiKey = (apiKey: string | null) => {
  if (android) {
    if (!android.writeApiKey(apiKey)) {
      return false
    }
  } else {
    write(KEYS.apiKey, apiKey)
  }
  useSettings.setState({ apiKey })
  return true
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

/**
 * 设置自定义 API 地址。空字符串表示恢复内置地址。
 * 非法地址直接拒绝（返回 false），避免存进去一个永远请求不通的值。
 */
export const setApiBaseUrl = (value: string | null): boolean => {
  const origin = normalizeOrigin(value)
  if ((value ?? '').trim() && !origin) {
    return false
  }
  write(KEYS.apiBaseUrl, origin)
  useSettings.setState({ apiBaseUrl: origin })
  setOriginOverride(origin)
  return true
}
/** 切换厂商预设：同时把完整 base url 与 Anthropic 通路的 origin 一起对齐。 */
export const setProvider = (id: string): void => {
  const preset = findProvider(id)
  const baseUrl = preset?.baseUrl || DEEPSEEK_BASE_URL
  write(KEYS.providerId, id)
  write(KEYS.providerBaseUrl, baseUrl)
  const origin = normalizeOrigin(baseUrl)
  write(KEYS.apiBaseUrl, origin)
  useSettings.setState({ providerId: id, providerBaseUrl: baseUrl, apiBaseUrl: origin })
  setOriginOverride(origin)
}

/** 手填完整 base url（带路径），origin 同步给 Anthropic 通路。 */
export const setProviderBaseUrl = (value: string): void => {
  const trimmed = value.trim().replace(/\/+$/, '')
  write(KEYS.providerBaseUrl, trimmed)
  const origin = normalizeOrigin(trimmed)
  write(KEYS.apiBaseUrl, origin)
  useSettings.setState({ providerBaseUrl: trimmed, apiBaseUrl: origin })
  setOriginOverride(origin)
}

export const setProviderModel = (model: string | null): void => {
  const value = model?.trim() ? model.trim() : null
  write(KEYS.providerModel, value)
  useSettings.setState({ providerModel: value })
}

/** 保存/移除 chips 里的模型名，去重且保序。 */
export const toggleSavedModel = (model: string): void => {
  const value = model.trim()
  if (!value) {
    return
  }
  const current = useSettings.getState().savedModels
  const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
  write(KEYS.savedModels, JSON.stringify(next))
  useSettings.setState({ savedModels: next })
}