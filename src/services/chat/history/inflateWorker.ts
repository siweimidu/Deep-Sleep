import { inflateSync } from 'fflate'

/**
 * 复用的解压 worker。
 *
 * 之前用过 fflate 的 AsyncInflate，但它每个实例都会新开一个 worker；
 * 导出包有成百上千个条目，光创建销毁 worker 就把时间吃光了。
 * 这里全程只用一个实例，按请求 id 配对回包。
 */

let worker: Worker | null = null
/** worker 一旦加载失败就永久走同步解压，避免后续请求发给一个死掉的实例而永远等不到回包。 */
let broken = false
let sequence = 0
const REQUEST_TIMEOUT_MS = 15000
const pending = new Map<number, { resolve: (data: Uint8Array) => void; reject: (error: Error) => void }>()

const merge = (chunks: Uint8Array[]) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

const workerUrl = () => new URL('static/js/inflate-worker.js', document.baseURI).toString()

const ensureWorker = (): Worker | null => {
  if (worker) {
    return worker
  }
  try {
    // 和 parseWorker.ts 同一套：产物是 dist/static/js/inflate-worker.js（自包含经典脚本，
    // 见 rspack.worker.config.ts）。不要用 new Worker(new URL(...), { type: 'module' })——
    // 主配置不会为它产出脚本，页面拿到 404，DEFLATE 归档（官方导出就是）就全导入失败。
    worker = new Worker(workerUrl())
    worker.onmessage = (event: MessageEvent<{ id: number; data?: ArrayBuffer; error?: string }>) => {
      const entry = pending.get(event.data.id)
      if (!entry) {
        return
      }
      pending.delete(event.data.id)
      if (event.data.error) {
        entry.reject(new Error(event.data.error))
        return
      }
      entry.resolve(new Uint8Array(event.data.data ?? new ArrayBuffer(0)))
    }
    worker.onerror = () => {
      broken = true
      for (const entry of pending.values()) {
        entry.reject(new Error('inflate worker failed'))
      }
      pending.clear()
      worker = null
    }
    worker.onmessageerror = () => {
      broken = true
      worker?.terminate()
      worker = null
      for (const entry of pending.values()) {
        entry.reject(new Error('inflate worker message error'))
      }
      pending.clear()
    }
  } catch {
    broken = true
    worker = null
  }
  return worker
}

/** 解压一段 deflate 数据；worker 不可用时退回主线程同步解压 */
export const inflateInWorker = async (chunks: Uint8Array[]): Promise<Uint8Array> => {
  const instance = broken ? null : ensureWorker()
  if (!instance) {
    return inflateSync(merge(chunks))
  }
  const id = ++sequence
  return new Promise<Uint8Array>((resolve, reject) => {
    // 超时兜底：数据已经 transfer 出去了，没法再同步解压，所以只能报错——但绝不能像以前那样
    // 永远停在 0%（用户看到的就是这个）。
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('inflate worker timeout'))
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, {
      resolve: (data) => {
        clearTimeout(timer)
        resolve(data)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    })
    const transfer = chunks.map((chunk) => chunk.buffer as ArrayBuffer)
    instance.postMessage({ id, chunks }, transfer)
  })
}

/** 导入结束或失败时释放 worker */
export const disposeInflateWorker = () => {
  worker?.terminate()
  worker = null
  for (const entry of pending.values()) {
    entry.reject(new Error('inflate worker disposed'))
  }
  pending.clear()
}
