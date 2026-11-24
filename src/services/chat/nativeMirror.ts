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
export const withMirrorMuted = async <T>(run: () => Promise<T>): Promise<T> => {
  const previous = muted
  muted = true
  try {
    return await run()
  } finally {
    muted = previous
  }
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
