import type { Session } from '../types.js'
import { readSessionFile } from './schema.js'
import { toLocalSession } from './toLocal.js'

/**
 * 会话解析的 worker 客户端。
 *
 * 与 inflateWorker 相同的三条约束：
 *   1. 产物必须由 rspack.worker.config.ts 单独打成自包含经典脚本（主配置的
 *      `new Worker(new URL(...))` 在本项目里不会产出脚本，页面会拿到 404）；
 *   2. worker 不可用/出错时退回主线程解析，导入不能因此失败；
 *   3. 每次请求带超时，绝不能让导入悬在那里。
 */

const OFFLOAD_MIN_CHARS = 8 * 1024
const REQUEST_TIMEOUT_MS = 20000

let worker: Worker | null = null
let broken = false
let sequence = 0
const pending = new Map<
  number,
  { resolve: (value: { session: Session; images: Map<string, string> }) => void; reject: (error: Error) => void }
>()

const ensureWorker = (): Worker | null => {
  if (worker) {
    return worker
  }
  if (broken) {
    return null
  }
  try {
    worker = new Worker(new URL('static/js/chat-parse-worker.js', document.baseURI).toString())
    worker.onmessage = (event: MessageEvent<{ id: number; session?: unknown; images?: [string, string][]; error?: string }>) => {
      const entry = pending.get(event.data.id)
      if (!entry) {
        return
      }
      pending.delete(event.data.id)
      if (event.data.error || !event.data.session) {
        entry.reject(new Error(event.data.error ?? 'parse worker returned nothing'))
        return
      }
      entry.resolve({
        session: event.data.session as Session,
        images: new Map(event.data.images ?? []),
      })
    }
    worker.onerror = () => {
      broken = true
      for (const entry of pending.values()) {
        entry.reject(new Error('parse worker failed'))
      }
      pending.clear()
      worker = null
    }
    worker.onmessageerror = () => {
      broken = true
      worker?.terminate()
      worker = null
    }
  } catch {
    broken = true
    worker = null
  }
  return worker
}

const parseInline = (text: string): { session: Session; images: Map<string, string> } => {
  const local = toLocalSession(readSessionFile(JSON.parse(text)))
  return { session: local.session, images: local.images }
}

/**
 * 解析一条会话 JSON。大于 8KB 且 worker 可用时在后台线程做，否则就地解析。
 *
 * **worker 只是加速路径，不能成为失败点**：它崩了、超时了、被系统回收了，都必须退回主线程解析。
 * 导入是用户唯一无法自行补救的操作（数据在文件里，但应用报错就结束），所以这里宁可慢一点也不能失败。
 * 唯一仍然抛出的错误来自主线程解析本身——那是数据真的坏了，与加速无关。
 */
export const parseSessionText = async (
  text: string
): Promise<{ session: Session; images: Map<string, string> }> => {
  if (text.length < OFFLOAD_MIN_CHARS) {
    return parseInline(text)
  }
  const instance = ensureWorker()
  if (!instance) {
    return parseInline(text)
  }
  const id = ++sequence
  try {
    return await new Promise<{ session: Session; images: Map<string, string> }>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('parse worker timeout'))
      }, REQUEST_TIMEOUT_MS)
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      try {
        instance.postMessage({ id, text })
      } catch (error) {
        clearTimeout(timer)
        pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  } catch {
    // 加速路径失败：标记降级并就地解析，导入继续
    broken = true
    worker?.terminate()
    worker = null
    for (const entry of pending.values()) {
      entry.reject(new Error('parse worker disposed'))
    }
    pending.clear()
    return parseInline(text)
  }
}

/** 导入结束时释放 worker（一次导入一个实例，避免常驻内存） */
export const disposeParseWorker = (): void => {
  worker?.terminate()
  worker = null
  for (const entry of pending.values()) {
    entry.reject(new Error('parse worker disposed'))
  }
  pending.clear()
}
