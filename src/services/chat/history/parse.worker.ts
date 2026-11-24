import { readSessionFile } from './schema.js'
import { toLocalSession } from './toLocal.js'

/**
 * 会话解析 worker：把 JSON.parse + schema 校验 + 映射这段纯 CPU 活搬离主线程。
 *
 * 只处理**单条**会话：导入是个顺序敏感的状态机（manifest → 会话 → 该会话的图片），
 * 批量化会打乱校验顺序；单条下沉已经能覆盖主要开销（大归档里单个会话常常几十 KB）。
 * 调用方对很小的会话仍走主线程，省掉一次往返。
 */

type Request = { id: number; text: string }

type Reply = {
  id: number
  /** 映射后的会话；出错时为 undefined */
  session?: unknown
  /** [图片归档路径, 文件 id][]，Map 不便直接回传 */
  images?: [string, string][]
  error?: string
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, text } = event.data
  let reply: Reply
  try {
    const local = toLocalSession(readSessionFile(JSON.parse(text)))
    reply = { id, session: local.session, images: [...local.images.entries()] }
  } catch (error) {
    reply = { id, error: String(error) }
  }
  ;(self as unknown as { postMessage: (value: Reply) => void }).postMessage(reply)
}
