import { create } from 'zustand'
import { android } from '../app/android.js'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'
import { setOriginOverride } from './api/originStore.js'
import { normalizeOrigin } from './api/endpoint.js'
import { DEEPSEEK_BASE_URL, findProvider } from './api/providers.js'
import {
  activeKeyOf,
  addKey,
  hasAnyKey,
  isKeyUnusable,
  keysOf,
  parseKeyring,
  removeKey,
  replaceActiveKey,
  rotateKey,
  selectKey,
  serializeKeyring,
  type Keyring,
} from './api/keyring.js'

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
  /** 当前厂商存的所有 Key（在用的那把就是 apiKey） */
  providerKeys: string[]
  /** 任意厂商存过 Key；用来决定要不要弹首次引导页 */
  anyKey: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  /** 多 Key 钥匙串（Web 端用；Android 存进原生加密槽） */
  keyring: 'replica:keyring',
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
  /** 厂商 id → 上次用的模型名，切回来时恢复，省得每家都重选一遍 */
  providerModelById: 'replica:provider-model-by-id',
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

/** 厂商 id → 上次选的模型名。切厂商时用它恢复，避免顺手带走过别家的模型名。 */
const readModelMap = (): Record<string, string> => {
  try {
    const value: unknown = JSON.parse(read(KEYS.providerModelById) ?? '{}')
    if (!value || typeof value !== 'object') {
      return {}
    }
    const map: Record<string, string> = {}
    for (const [providerId, model] of Object.entries(value as Record<string, unknown>)) {
      if (typeof model === 'string' && model.trim()) {
        map[providerId] = model.trim()
      }
    }
    return map
  } catch {
    return {}
  }
}

const rememberModel = (providerId: string, model: string | null): void => {
  const map = readModelMap()
  const next = model
    ? { ...map, [providerId]: model }
    : Object.fromEntries(Object.entries(map).filter(([id]) => id !== providerId))
  write(KEYS.providerModelById, JSON.stringify(next))
}

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

/**
 * 钥匙串的原始串。Android 上存在原生加密槽里（整份 JSON 当一个字符串），Web 存 localStorage；
 * 老版本槽里是一把裸 Key，解析时会迁到当前厂商名下。
 */
const readKeyringRaw = (): string | null =>
  android ? android.readApiKey() : (read(KEYS.keyring) ?? read(KEYS.apiKey))

const startProvider = initialProvider()
let keyring: Keyring = parseKeyring(readKeyringRaw(), startProvider.providerId)

const persistKeyring = (next: Keyring): boolean => {
  const payload = serializeKeyring(next)
  if (android) {
    return android.writeApiKey(payload)
  }
  write(KEYS.keyring, payload)
  return true
}

/** 改完钥匙串后同步对外状态：在用的 Key、当前厂商的列表、是否存过任何 Key。 */
const applyKeyring = (next: Keyring, providerId: string): boolean => {
  if (!persistKeyring(next)) {
    return false
  }
  keyring = next
  useSettings.setState({
    apiKey: activeKeyOf(next, providerId),
    providerKeys: keysOf(next, providerId),
    anyKey: hasAnyKey(next),
  })
  return true
}

/** 这把 Key 用不了就换同厂商下一把，直到都试过一遍。 */
export const withKeyRotation = async <T>(
  providerId: string,
  run: (apiKey: string) => Promise<T>
): Promise<T> => {
  const total = keysOf(keyring, providerId).length
  if (total === 0) {
    throw new Error('missing api key')
  }
  let lastError: unknown = null
  for (let attempt = 0; attempt < total; attempt += 1) {
    const apiKey = activeKeyOf(keyring, providerId)
    if (!apiKey) {
      break
    }
    try {
      return await run(apiKey)
    } catch (error) {
      if (total === 1 || !isKeyUnusable(error)) {
        throw error
      }
      lastError = error
      applyKeyring(rotateKey(keyring, providerId), providerId)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('missing api key')
}

/**
 * 流式版本：只在"一个增量都还没吐出来"的时候换 Key 重来，
 * 否则用户会看到半截回答接上半截回答。
 */
export async function* streamWithKeyRotation<T>(
  providerId: string,
  make: (apiKey: string) => AsyncGenerator<T>
): AsyncGenerator<T> {
  const total = Math.max(keysOf(keyring, providerId).length, 1)
  let lastError: unknown = null
  for (let attempt = 0; attempt < total; attempt += 1) {
    const apiKey = activeKeyOf(keyring, providerId)
    if (!apiKey) {
      throw new Error('missing api key')
    }
    let produced = false
    try {
      for await (const event of make(apiKey)) {
        produced = true
        yield event
      }
      return
    } catch (error) {
      if (produced || total === 1 || !isKeyUnusable(error)) {
        throw error
      }
      lastError = error
      applyKeyring(rotateKey(keyring, providerId), providerId)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('missing api key')
}

export const useSettings = create<Settings>(() => ({
  apiKey: activeKeyOf(keyring, startProvider.providerId),
  providerKeys: keysOf(keyring, startProvider.providerId),
  anyKey: hasAnyKey(keyring),
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
  ...startProvider,
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

/**
 * 设置"当前厂商在用的那把 Key"：替换在用的那把，没有就追加；传空表示删掉它。
 * 官方引导页和设置里的单 Key 输入都用这个入口。
 */
export const setApiKey = (apiKey: string | null): boolean => {
  const { providerId } = useSettings.getState()
  const value = apiKey?.trim() ?? ''
  if (!value) {
    const current = activeKeyOf(keyring, providerId)
    return current ? applyKeyring(removeKey(keyring, providerId, current), providerId) : true
  }
  return applyKeyring(replaceActiveKey(keyring, providerId, value), providerId)
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
/**
 * 切换厂商预设：base url 与 Anthropic 通路的 origin 一起对齐，
 * 模型名换成这家上次用的那把（没有就是未选），绝不会把别家的模型名带过去。
 */
export const setProvider = (id: string): void => {
  const preset = findProvider(id)
  const baseUrl = preset?.baseUrl || DEEPSEEK_BASE_URL
  const remembered = readModelMap()[id] ?? null
  write(KEYS.providerId, id)
  write(KEYS.providerBaseUrl, baseUrl)
  const origin = normalizeOrigin(baseUrl)
  write(KEYS.apiBaseUrl, origin)
  write(KEYS.providerModel, remembered)
  // 每家有自己的钥匙串，换厂商要连 Key 一起换过去；否则会拿上一家的 Key 去请求这一家。
  useSettings.setState({
    providerId: id,
    providerBaseUrl: baseUrl,
    apiBaseUrl: origin,
    providerModel: remembered,
    apiKey: activeKeyOf(keyring, id),
    providerKeys: keysOf(keyring, id),
  })
  setOriginOverride(origin)
}

/** 给当前厂商追加一把 Key，并设为在用。 */
export const addProviderKey = (apiKey: string): boolean => {
  const { providerId } = useSettings.getState()
  const key = apiKey.trim()
  if (!key) {
    return false
  }
  return applyKeyring(addKey(keyring, providerId, key), providerId)
}

/** 删掉当前厂商的一把 Key。 */
export const removeProviderKey = (apiKey: string): boolean => {
  const { providerId } = useSettings.getState()
  return applyKeyring(removeKey(keyring, providerId, apiKey), providerId)
}

/** 指定当前厂商用哪一把。 */
export const selectProviderKey = (apiKey: string): boolean => {
  const { providerId } = useSettings.getState()
  return applyKeyring(selectKey(keyring, providerId, apiKey), providerId)
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
  rememberModel(useSettings.getState().providerId, value)
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