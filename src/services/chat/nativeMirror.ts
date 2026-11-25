import { android } from '../../app/android.js'
import type { Session } from './types.js'

/**
 * 聊天记录的原生镜像（SQLite）。
 *
 * IndexedDB 会因为"清除网站数据"、系统回收、换内核而静默丢数据，而聊天记录不可再生；
 * 这里在每次落盘后把整会话 JSON 再写一份到原生 SQLite，前端发现 IndexedDB 空了就从它恢复。
 *
 * 几个刻意的选择：
 *   1. **按会话整块写**，不做增量日志——删除/重命名/导入合并最终都表现为整会话写，
 *      增量反而要处理更多乱序与回放问题。
 *   2. **800ms 合并写**：发消息时每追加一条都会落盘，逐条过桥会把 JNI 调用打爆；
 *      合并后一次写入，页面进后台时再强制 flush 一次，最坏丢不到一秒。
 *   3. **失败一律静默**：镜像只是兜底，不能让它的异常冒到聊天主流程里。
 *   4. 没有原生桥（桌面浏览器 / 测试环境）时整个功能自动失效，不需要调用方判断。
 */

type MirrorBridge = {
  mirrorPut?: (id: string, body: string) => void
  mirrorRemove?: (id: string) => void
  mirrorDump?: () => string
  mirrorIds?: () => string
  mirrorPutFile?: (id: string, body: string) => void
  mirrorRemoveFile?: (id: string) => void
  mirrorFileIds?: () => string
  mirrorDumpFiles?: (idsJson: string) => string
}

const bridge = (): MirrorBridge | null => {
  const device = android as unknown as MirrorBridge | null
  return device?.mirrorPut && device?.mirrorDump ? device : null
}

const FLUSH_DELAY_MS = 800

let muted = false
let timer: ReturnType<typeof setTimeout> | null = null
const pendingIds = new Set<string>()
const pendingBodies = new Map<string, string>()

const flush = (): void => {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  const device = bridge()
  if (!device) {
    pendingIds.clear()
    pendingBodies.clear()
    return
  }
  for (const id of pendingIds) {
    const body = pendingBodies.get(id)
    try {
      if (body === undefined) {
        device.mirrorRemove?.(id)
      } else {
        device.mirrorPut?.(id, body)
      }
    } catch {
      // 单条失败不影响其它会话
    }
  }
  pendingIds.clear()
  pendingBodies.clear()
}

const schedule = (): void => {
  if (timer === null) {
    timer = setTimeout(flush, FLUSH_DELAY_MS)
  }
}

/** 会话落盘后同步一份到原生镜像。 */
export const mirrorSession = (session: Session): void => {
  if (muted || !bridge()) {
    return
  }
  try {
    pendingBodies.set(session.id, JSON.stringify(session))
  } catch {
    return
  }
  pendingIds.add(session.id)
  schedule()
}

/** 会话被删除时清掉镜像，避免"删了又复活"。 */
export const forgetMirroredSession = (id: string): void => {
  if (!bridge()) {
    return
  }
  pendingBodies.delete(id)
  pendingIds.add(id)
  schedule()
}

/** 读出全部镜像会话；单条 JSON 坏掉只跳过它自己。 */
export const readMirroredSessions = (): Session[] => {
  const device = bridge()
  if (!device) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(device.mirrorDump?.() ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) {
    return []
  }
  const sessions: Session[] = []
  for (const pair of parsed) {
    if (!Array.isArray(pair) || typeof pair[1] !== 'string') {
      continue
    }
    try {
      const session = JSON.parse(pair[1]) as Session
      if (session && typeof session.id === 'string' && Array.isArray(session.messages)) {
        sessions.push(session)
      }
    } catch {
      // 跳过坏的这一条
    }
  }
  return sessions
}

/** 恢复期间静音，避免"读镜像 → 写 IndexedDB → 又写镜像"的回环。 */
/** 恢复期间不应再写镜像。 */
export const mirrorIsMuted = (): boolean => muted

export const withMirrorMuted = async <T>(run: () => Promise<T>): Promise<T> => {
  const previous = muted
  muted = true
  try {
    return await run()
  } finally {
    muted = previous
  }
}

/** 只读 id：判断"哪些会话还没进镜像"时不能拿 dump，那会把几百 MB 全序列化一遍。 */
export const readMirroredIds = (): Set<string> => {
  const device = bridge()
  if (!device?.mirrorIds) {
    return new Set()
  }
  try {
    const parsed: unknown = JSON.parse(device.mirrorIds() ?? '[]')
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
    )
  } catch {
    return new Set()
  }
}

const idle = (run: () => void): void => {
  const scheduler = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  }
  if (scheduler.requestIdleCallback) {
    scheduler.requestIdleCallback(run, { timeout: 2000 })
    return
  }
  setTimeout(run, 200)
}

/**
 * 启动回填。
 *
 * 镜像只在 saveSession 时写入，所以功能上线**之前**就存在的会话永远进不去——
 * 而这批老数据恰恰最需要兜底（真正会因为清缓存而丢的就是它们）。
 * 这里空闲时把缺口补齐：一次最多 3 个会话，绝不和聊天抢主线程。
 */
export const backfillMirror = (
  ids: string[],
  load: (id: string) => Promise<Session | undefined>
): void => {
  if (!bridge() || ids.length === 0) {
    return
  }
  const have = readMirroredIds()
  const missing = ids.filter((id) => !have.has(id))
  if (missing.length === 0) {
    return
  }
  let cursor = 0
  const pump = (): void => {
    for (let step = 0; step < 3 && cursor < missing.length; step += 1) {
      const id = missing[cursor]
      cursor += 1
      void load(id)
        .then((session) => {
          if (session) {
            mirrorSession(session)
          }
        })
        .catch(() => undefined)
    }
    if (cursor < missing.length) {
      idle(pump)
    }
  }
  idle(pump)
}

/** 页面进入后台/关闭前立刻落盘，补上合并窗口内最后那一批。 */
export const installMirrorFlush = (): void => {
  if (!bridge()) {
    return
  }
  const handler = (): void => flush()
  window.addEventListener('pagehide', handler)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      handler()
    }
  })
}
// ── 附件镜像 ────────────────────────────────────────────────────────────────
// 与上面 backfillMirror 完全独立：那个函数负责"会话文本"，这里负责附件字节。
// 上一轮把两件事混在一个流程里，既拖慢了会话回填，也让"慢"和"坏"无法区分——现在分开。

/** 单个附件超过这个大小就不进镜像：宁可少备份，也不要在手机上做几十 MB 的 base64。 */
const MAX_MIRRORED_FILE_BYTES = 12 * 1024 * 1024
/** 全量扫描的进度游标：中断后从断点继续，不必每次从头扫 539 个会话。 */
const SWEEP_KEY = 'replica:file-mirror-sweep'
const SWEEP_CHUNK = 20

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('blob read failed'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })

const base64ToBytes = (base64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(base64)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/** 已备份的附件 id。 */
export const readMirroredFileIds = (): Set<string> => {
  const device = bridge()
  if (!device?.mirrorFileIds) {
    return new Set()
  }
  try {
    const parsed: unknown = JSON.parse(device.mirrorFileIds() ?? '[]')
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
    )
  } catch {
    return new Set()
  }
}

/** 把一个附件写进镜像。失败静默：镜像只是兜底。 */
export const mirrorFile = async (id: string, blob: Blob): Promise<void> => {
  const device = bridge()
  if (!device?.mirrorPutFile || !id || !blob || blob.size === 0) {
    return
  }
  if (blob.size > MAX_MIRRORED_FILE_BYTES) {
    return
  }
  try {
    device.mirrorPutFile(id, await blobToBase64(blob))
  } catch {
    // 单个附件失败不影响其它
  }
}

/** 按 id 取回附件字节；调用方决定用什么 MIME 包成 Blob。 */
export const readMirroredFiles = (ids: string[]): Map<string, Uint8Array<ArrayBuffer>> => {
  const device = bridge()
  const out = new Map<string, Uint8Array<ArrayBuffer>>()
  if (!device?.mirrorDumpFiles || ids.length === 0) {
    return out
  }
  try {
    const parsed: unknown = JSON.parse(device.mirrorDumpFiles(JSON.stringify(ids)) ?? '[]')
    if (!Array.isArray(parsed)) {
      return out
    }
    for (const pair of parsed) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') {
        continue
      }
      try {
        out.set(pair[0], base64ToBytes(pair[1]))
      } catch {
        // 单条坏了跳过
      }
    }
  } catch {
    return out
  }
  return out
}

/** 把一条会话引用到的附件补进镜像；保存路径用。 */
export const mirrorSessionFiles = (
  session: Session,
  loadFile: (id: string) => Promise<Blob | undefined>
): void => {
  const ids = new Set<string>()
  for (const message of session.messages) {
    if (message.role !== 'user') {
      continue
    }
    for (const file of message.files) {
      ids.add(file.id)
    }
  }
  if (ids.size === 0) {
    return
  }
  void (async () => {
    const have = readMirroredFileIds()
    for (const id of ids) {
      if (have.has(id)) {
        continue
      }
      const blob = await loadFile(id).catch(() => undefined)
      if (blob) {
        await mirrorFile(id, blob)
      }
    }
  })()
}

/**
 * 附件全量扫描：补历史会话里从未备份过的图片。
 *
 * 为什么写成"按块 + 存游标"：
 *   · 539 个会话串行读一次要十几秒，用 requestIdleCallback 逐条让出会更慢，慢到像坏了；
 *     按 20 个一块、块间 setTimeout(0) 让出，几秒内就能跑完。
 *   · 游标存进 localStorage，中途被杀下次接着跑，不会每次重扫。
 */
export const sweepMirrorFiles = async (
  ids: string[],
  load: (id: string) => Promise<Session | undefined>,
  loadFile: (id: string) => Promise<Blob | undefined>
): Promise<void> => {
  if (!bridge()?.mirrorPutFile || ids.length === 0) {
    return
  }
  let cursor = 0
  try {
    cursor = Number(localStorage.getItem(SWEEP_KEY) ?? '0')
    if (!Number.isFinite(cursor) || cursor < 0) {
      cursor = 0
    }
  } catch {
    cursor = 0
  }
  while (cursor < ids.length) {
    const slice = ids.slice(cursor, cursor + SWEEP_CHUNK)
    const fileIds = new Set<string>()
    for (const id of slice) {
      const session = await load(id).catch(() => undefined)
      if (!session) {
        continue
      }
      for (const message of session.messages) {
        if (message.role !== 'user') {
          continue
        }
        for (const file of message.files) {
          fileIds.add(file.id)
        }
      }
    }
    const have = readMirroredFileIds()
    for (const id of fileIds) {
      if (have.has(id)) {
        continue
      }
      const blob = await loadFile(id).catch(() => undefined)
      if (blob) {
        await mirrorFile(id, blob)
      }
    }
    cursor += slice.length
    try {
      localStorage.setItem(SWEEP_KEY, String(cursor))
    } catch {
      // 存不下就下次重扫，只多花时间
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}