/**
 * 多 Key 钥匙串：一个厂商可以存多把 Key，额度用完时换下一把。
 *
 * 这一层只做纯数据（解析 / 增删 / 轮换），不碰存储也不碰 React，
 * 所以能直接单测。真正的落盘在 settings.ts：Android 存进原生加密槽，Web 存 localStorage。
 */

export type Keyring = {
  version: 1
  /** 厂商 id → Key 列表（去重、保序） */
  keys: Record<string, string[]>
  /** 厂商 id → 正在用第几把 */
  active: Record<string, number>
}

export const emptyKeyring = (): Keyring => ({ version: 1, keys: {}, active: {} })

const clean = (raw: string): string => raw.trim()

/**
 * 解析存量数据。裸字符串是旧格式（只有一把 Key），归到当前厂商名下；
 * 解析不出来就当空的，绝不把整个钥匙串丢掉再写回去。
 */
export const parseKeyring = (raw: string | null | undefined, legacyProviderId: string): Keyring => {
  const text = (raw ?? '').trim()
  if (!text) {
    return emptyKeyring()
  }
  if (!text.startsWith('{')) {
    return { version: 1, keys: { [legacyProviderId]: [text] }, active: { [legacyProviderId]: 0 } }
  }
  try {
    const body = JSON.parse(text) as { keys?: unknown; active?: unknown }
    const source = (body.keys ?? {}) as Record<string, unknown>
    const keys: Record<string, string[]> = {}
    for (const [providerId, list] of Object.entries(source)) {
      if (!Array.isArray(list)) {
        continue
      }
      const unique = [
        ...new Set(
          list
            .filter((item): item is string => typeof item === 'string')
            .map((item) => clean(item))
            .filter((item) => item.length > 0)
        ),
      ]
      if (unique.length > 0) {
        keys[providerId] = unique
      }
    }
    const activeSource = (body.active ?? {}) as Record<string, unknown>
    const active: Record<string, number> = {}
    for (const providerId of Object.keys(keys)) {
      const index = activeSource[providerId]
      const size = keys[providerId]?.length ?? 0
      active[providerId] =
        typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < size ? index : 0
    }
    return { version: 1, keys, active }
  } catch {
    return emptyKeyring()
  }
}

export const serializeKeyring = (keyring: Keyring): string => JSON.stringify(keyring)

export const keysOf = (keyring: Keyring, providerId: string): string[] => keyring.keys[providerId] ?? []

export const activeIndexOf = (keyring: Keyring, providerId: string): number => {
  const size = keysOf(keyring, providerId).length
  if (size === 0) {
    return -1
  }
  const index = keyring.active[providerId] ?? 0
  return index >= 0 && index < size ? index : 0
}

export const activeKeyOf = (keyring: Keyring, providerId: string): string | null => {
  const list = keysOf(keyring, providerId)
  const index = activeIndexOf(keyring, providerId)
  return index < 0 ? null : (list[index] ?? null)
}

/** 追加一把 Key（去重），并把它设为在用。 */
export const addKey = (keyring: Keyring, providerId: string, rawKey: string): Keyring => {
  const key = clean(rawKey)
  if (!key) {
    return keyring
  }
  const list = keysOf(keyring, providerId)
  const existing = list.indexOf(key)
  const nextList = existing >= 0 ? list : [...list, key]
  return {
    ...keyring,
    keys: { ...keyring.keys, [providerId]: nextList },
    active: { ...keyring.active, [providerId]: existing >= 0 ? existing : nextList.length - 1 },
  }
}

/** 删掉一把；删的正好是在用的那把时，落到同位置或前一位置。 */
export const removeKey = (keyring: Keyring, providerId: string, rawKey: string): Keyring => {
  const key = clean(rawKey)
  const list = keysOf(keyring, providerId)
  const index = list.indexOf(key)
  if (index < 0) {
    return keyring
  }
  const nextList = list.filter((item) => item !== key)
  if (nextList.length === 0) {
    return { ...keyring, keys: without(keyring.keys, providerId), active: without(keyring.active, providerId) }
  }
  return {
    ...keyring,
    keys: { ...keyring.keys, [providerId]: nextList },
    active: { ...keyring.active, [providerId]: Math.min(index, nextList.length - 1) },
  }
}

/**
 * 这把 Key 是不是"用不了"了（无效 / 没额度 / 被限流），值得换同厂商的下一把。
 *
 * 400/404 说明请求本身不对，换 Key 没用；5xx 是对方服务的问题，同样不换。
 * 这个函数放在这里而不是 errors.ts：settings 要判断它，而 errors → client → i18n → settings
 * 已经是条回路，再从 settings 引 errors 就成环了。
 */
export const isKeyUnusable = (error: unknown): boolean => {
  const status = (error as { status?: unknown } | null)?.status
  if (typeof status === 'number' && (status === 401 || status === 402 || status === 403 || status === 429)) {
    return true
  }
  const text = error instanceof Error ? error.message : String(error ?? '')
  return /insufficient[_ ]?quota|exceeded your current quota|quota exceeded|no credit|credit balance|invalid[_ ]api[_ ]key|incorrect api key|余额|额度|欠费/i.test(
    text
  )
}

/** 去掉某一家：不用 delete 动态键，避免 lint 的 no-dynamic-delete 与残留引用。 */
const without = <T>(record: Record<string, T>, providerId: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([name]) => name !== providerId))

/** 用一把新 Key 顶掉在用的那把；没有在用的就当成追加。 */
export const replaceActiveKey = (keyring: Keyring, providerId: string, rawKey: string): Keyring => {
  const key = clean(rawKey)
  if (!key) {
    return keyring
  }
  const list = keysOf(keyring, providerId)
  const index = activeIndexOf(keyring, providerId)
  if (index < 0) {
    return { ...keyring, keys: { ...keyring.keys, [providerId]: [key] }, active: { ...keyring.active, [providerId]: 0 } }
  }
  const nextList = [...list]
  nextList[index] = key
  const firstHit = nextList.indexOf(key)
  const unique = nextList.filter((item, at) => at === firstHit || item !== key)
  return {
    ...keyring,
    keys: { ...keyring.keys, [providerId]: unique },
    active: { ...keyring.active, [providerId]: Math.min(unique.indexOf(key), unique.length - 1) },
  }
}

export const selectKey = (keyring: Keyring, providerId: string, rawKey: string): Keyring => {
  const index = keysOf(keyring, providerId).indexOf(clean(rawKey))
  if (index < 0) {
    return keyring
  }
  return { ...keyring, active: { ...keyring.active, [providerId]: index } }
}

/** 换下一把，绕回开头；只有一把时原地不动。 */
export const rotateKey = (keyring: Keyring, providerId: string): Keyring => {
  const size = keysOf(keyring, providerId).length
  if (size < 2) {
    return keyring
  }
  const current = activeIndexOf(keyring, providerId)
  return { ...keyring, active: { ...keyring.active, [providerId]: (current + 1) % size } }
}

export const hasAnyKey = (keyring: Keyring): boolean =>
  Object.values(keyring.keys).some((list) => list.length > 0)

/** 界面展示用：只露头尾，中间省略。 */
export const maskKey = (raw: string): string => {
  const key = clean(raw)
  if (key.length <= 8) {
    return '••••'
  }
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}
