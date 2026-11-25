/**
 * OpenAI 兼容协议的流式对话客户端。
 *
 * 为什么必须有这一层：应用原本只走 Anthropic 兼容接口（`/anthropic/v1/messages`），
 * 而第三方厂商基本都是 OpenAI 形状的 `/chat/completions`。没有它，选了厂商也发不出消息。
 *
 * 只做必要的事：
 *   · 消息转换：system 单独一条，历史按 role 平铺；
 *   · SSE 增量：按 `\n\n` 切帧、`data:` 取负载、`[DONE]` 收尾；
 *   · 错误：复用 Anthropic 通路的 ApiError，界面才会用同一套提示（401 提示换 Key），
 *     而不是把上游的 JSON 原文当成回答贴进对话。
 */

import { ApiError, readErrorResponse } from './client.js'
import type { MessageParam } from './types.js'

export type OpenAiMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type OpenAiChatOptions = {
  baseUrl: string
  apiKey: string
  model: string
  messages: OpenAiMessage[]
  signal?: AbortSignal
  /** 只要首段就够时（例如"测试性能"）可传 1，收到即结束 */
  maxTokens?: number
  temperature?: number
}

export type OpenAiDelta = {
  /** 本段正文 */
  text: string
  /** 本段思考过程（推理模型才有），对应 `reasoning_content` */
  reasoning: string
  /** 结束原因（finish_reason），最后一段才有 */
  finishReason?: string
}

/** 多久没有任何增量就认定连接已死。推理模型会持续发 reasoning_content，所以不会误伤。 */
const IDLE_TIMEOUT_MS = 60000

const trimBase = (raw: string): string => {
  const value = (raw ?? '').trim().replace(/\/+$/, '')
  if (!value || !/^https?:\/\//i.test(value)) {
    throw new Error('invalid base url')
  }
  return value
}

/** 把内部消息模型摊平成 OpenAI 的 role/content 结构。 */
export const toOpenAiMessages = (system: string, history: MessageParam[]): OpenAiMessage[] => {
  const out: OpenAiMessage[] = []
  const prompt = system.trim()
  if (prompt) {
    out.push({ role: 'system', content: prompt })
  }
  for (const item of history) {
    // assistant 的 content 是块数组，user 可能是字符串或块数组：都摊平成纯文本，
    // 否则历史里的助手发言会被当成空内容整条丢掉（第三方模型就"失忆"了）。
    let content = ''
    if (typeof item.content === 'string') {
      content = item.content
    } else if (Array.isArray(item.content)) {
      content = item.content
        .map((block) => (block as { type?: string; text?: string })?.type === 'text' ? ((block as { text?: string }).text ?? '') : '')
        .join('')
    }
    if (!content.trim()) {
      continue
    }
    out.push({ role: item.role === 'assistant' ? 'assistant' : 'user', content })
  }
  return out
}

/** 解析一行 SSE 数据帧；不是正文的帧返回 null。 */
export const parseOpenAiFrame = (frame: string): OpenAiDelta | null => {
  const lines = frame.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) {
      continue
    }
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') {
      continue
    }
    try {
      const parsed: unknown = JSON.parse(payload)
      const delta = (parsed as {
        choices?: {
          delta?: { content?: unknown; reasoning_content?: unknown }
          finish_reason?: unknown
        }[]
      })?.choices?.[0]
      if (!delta) {
        continue
      }
      const text = typeof delta.delta?.content === 'string' ? delta.delta.content : ''
      // 推理模型把思考放在 reasoning_content：小 max_tokens 下正文可能整段为空，
      // 丢掉它用户就只看到一条空回复。
      const reasoning =
        typeof delta.delta?.reasoning_content === 'string' ? delta.delta.reasoning_content : ''
      const finishReason = typeof delta.finish_reason === 'string' ? delta.finish_reason : undefined
      if (!text && !reasoning && !finishReason) {
        continue
      }
      return { text, reasoning, finishReason }
    } catch {
      // 单帧解析失败不影响后续帧
    }
  }
  return null
}

/**
 * 发起流式对话，逐段回调正文。
 * 返回聚合后的完整文本，调用方不必自己拼。
 */
export const streamOpenAiChat = async (
  options: OpenAiChatOptions,
  onDelta?: (delta: OpenAiDelta) => void
): Promise<{ text: string; finishReason?: string }> => {
  const root = trimBase(options.baseUrl)
  if (!options.apiKey.trim()) {
    throw new Error('missing api key')
  }
  if (!options.model.trim()) {
    throw new Error('missing model')
  }
  const body: Record<string, unknown> = {
    model: options.model.trim(),
    messages: options.messages,
    stream: true,
  }
  if (typeof options.maxTokens === 'number') {
    body.max_tokens = options.maxTokens
  }
  if (typeof options.temperature === 'number') {
    body.temperature = options.temperature
  }
  // 连不通的域名既不返回也不拒绝：没有看门狗的话这条流会永远挂着。
  const controller = new AbortController()
  let stalled = false
  let watchdog = setTimeout(() => {
    stalled = true
    controller.abort()
  }, IDLE_TIMEOUT_MS)
  const touch = (): void => {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => {
      stalled = true
      controller.abort()
    }, IDLE_TIMEOUT_MS)
  }
  const relayAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', relayAbort, { once: true })

  const response = await fetch(`${root}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey.trim()}`,
      accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).catch((error: unknown) => {
    if (options.signal?.aborted) {
      throw error
    }
    if (stalled) {
      throw new ApiError('network', 'request timed out')
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  })
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  if (!response.body) {
    throw new Error('no response body')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let finishReason: string | undefined
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }
      touch()
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const delta = parseOpenAiFrame(frame)
        if (delta) {
          if (delta.text) {
            text += delta.text
          }
          if (delta.finishReason) {
            finishReason = delta.finishReason
          }
          // 只回调有内容的帧：结束帧的 finish_reason 已经由返回值给出，
          // 再回调一次空增量会让调用方多渲染一次"空增量"。
          if (delta.text || delta.reasoning) {
            onDelta?.(delta)
          }
        }
        boundary = buffer.indexOf('\n\n')
      }
    }
    // 收尾：最后一帧可能没有空行结尾
    if (buffer.trim()) {
      const delta = parseOpenAiFrame(buffer)
      if (delta) {
        text += delta.text
        finishReason = delta.finishReason ?? finishReason
        if (delta.text || delta.reasoning) {
          onDelta?.(delta)
        }
      }
    }
  } finally {
    clearTimeout(watchdog)
    options.signal?.removeEventListener('abort', relayAbort)
    reader.releaseLock()
  }
  return { text, finishReason }
}
/**
 * 把 OpenAI 兼容的流适配成应用内部那套 Anthropic 风格事件。
 *
 * 为什么用适配器而不是在发送链路里写第二个循环：消费侧（store.ts）那段循环还要处理
 * 思考块、工具块、重试、停止、用量、标题请求等一整套逻辑，复制一份出来只会让两条协议越走越远。
 * 这里把"正文增量"和"思考增量"翻译成 `content_block_*` 事件，其余保持不变。
 */
export type ThirdPartyEvent =
  | { type: 'content_block_start'; index: number; content_block: { type: 'text'; text: string } }
  | {
      type: 'content_block_start'
      index: number
      content_block: { type: 'thinking'; thinking: string; signature: string }
    }
  | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } }
  | { type: 'content_block_delta'; index: number; delta: { type: 'thinking_delta'; thinking: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string } }
  | { type: 'message_stop' }

/** OpenAI 的 finish_reason 翻成内部那套 stop_reason；`length` 必须保留，否则截断会被当成正常结束。 */
const toStopReason = (finishReason: string | undefined): string => {
  if (finishReason === 'length') {
    return 'max_tokens'
  }
  if (finishReason === 'tool_calls') {
    return 'tool_use'
  }
  return 'end_turn'
}

export async function* streamThirdPartyChat(options: {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  history: MessageParam[]
  signal?: AbortSignal
}): AsyncGenerator<ThirdPartyEvent> {
  // 真正的流式：worker 写到队列，消费者边到边取，绝不攒完再发。
  const queue: OpenAiDelta[] = []
  let finishReason: string | undefined
  let wake: (() => void) | null = null
  let finished = false
  let failure: unknown = null
  const kick = (): void => {
    const resolve = wake
    wake = null
    resolve?.()
  }
  const pump = streamOpenAiChat(
    {
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      model: options.model,
      messages: toOpenAiMessages(options.system, options.history),
      signal: options.signal,
    },
    (delta) => {
      finishReason = delta.finishReason ?? finishReason
      queue.push(delta)
      kick()
    }
  )
    .then((result) => {
      finishReason = result.finishReason ?? finishReason
      finished = true
      kick()
    })
    .catch((error: unknown) => {
      failure = error
      finished = true
      kick()
    })

  // 块按需打开：思考块在前、正文在后，索引按出现顺序递增，
  // 这样界面既能先看到思考，又不必为只有正文的厂商多发一个空块。
  let thinkingIndex = -1
  let textIndex = -1
  let nextIndex = 0
  for (;;) {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) {
        break
      }
      if (item.reasoning) {
        if (thinkingIndex < 0) {
          thinkingIndex = nextIndex
          nextIndex += 1
          yield {
            type: 'content_block_start',
            index: thinkingIndex,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          }
        }
        yield {
          type: 'content_block_delta',
          index: thinkingIndex,
          delta: { type: 'thinking_delta', thinking: item.reasoning },
        }
      }
      if (item.text) {
        if (thinkingIndex >= 0 && textIndex < 0) {
          yield { type: 'content_block_stop', index: thinkingIndex }
        }
        if (textIndex < 0) {
          textIndex = nextIndex
          nextIndex += 1
          yield {
            type: 'content_block_start',
            index: textIndex,
            content_block: { type: 'text', text: '' },
          }
        }
        yield {
          type: 'content_block_delta',
          index: textIndex,
          delta: { type: 'text_delta', text: item.text },
        }
      }
    }
    if (finished) {
      break
    }
    await new Promise<void>((resolve) => {
      wake = resolve
      if (finished || queue.length > 0) {
        resolve()
      }
    })
  }
  await pump
  if (failure) {
    throw failure instanceof Error ? failure : new Error(String(failure))
  }
  if (thinkingIndex >= 0 && textIndex < 0) {
    yield { type: 'content_block_stop', index: thinkingIndex }
  }
  if (textIndex >= 0) {
    yield { type: 'content_block_stop', index: textIndex }
  }
  yield { type: 'message_delta', delta: { stop_reason: toStopReason(finishReason) } }
  yield { type: 'message_stop' }
}