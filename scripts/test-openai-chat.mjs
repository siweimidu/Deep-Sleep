// OpenAI 兼容客户端：消息转换、SSE 帧解析、流式聚合（fetch 用桩，不联网）。
// 运行：node --experimental-transform-types --no-warnings --import ./rust/record-shim.mjs --import ./rust/register-ts.mjs scripts/test-openai-chat.mjs
import { toOpenAiMessages, parseOpenAiFrame, streamOpenAiChat, streamThirdPartyChat } from '../src/services/api/openaiChat.ts'

let failed = 0
const check = (name, ok, extra = '') => {
  if (ok) console.log('  ✓', name)
  else {
    failed += 1
    console.log('  ✗', name, extra)
  }
}

// ── 消息转换 ────────────────────────────────────────────────────────────────
const history = [
  { role: 'user', content: '你好' },
  { role: 'assistant', content: [{ type: 'text', text: '在的' }, { type: 'thinking', thinking: '忽略' }] },
  { role: 'user', content: [{ type: 'text', text: '继续' }] },
  { role: 'user', content: '   ' },
]
const converted = toOpenAiMessages('你是助手', history)
check('system 置顶', converted[0].role === 'system' && converted[0].content === '你是助手')
check('用户消息保留', converted[1].content === '你好')
check('助手块数组被摊平', converted[2].role === 'assistant' && converted[2].content === '在的', converted[2].content)
check('用户块数组被摊平', converted[3].content === '继续')
check('空白消息被丢弃', converted.length === 4, String(converted.length))
check('无 system 时不产生空 system 条', toOpenAiMessages('   ', []).length === 0)

// ── SSE 帧解析 ──────────────────────────────────────────────────────────────
check(
  '正文帧',
  parseOpenAiFrame('data: {"choices":[{"delta":{"content":"abc"}}]}')?.text === 'abc'
)
check(
  '结束帧带 finish_reason',
  parseOpenAiFrame('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}')?.finishReason === 'stop'
)
check('DONE 帧忽略', parseOpenAiFrame('data: [DONE]') === null)
check('心跳/注释帧忽略', parseOpenAiFrame(': keep-alive') === null)
check('坏 JSON 不抛', parseOpenAiFrame('data: {oops') === null)
check('空 choices 忽略', parseOpenAiFrame('data: {"choices":[]}') === null)
check(
  'usage 帧单独到达也解析得出来',
  parseOpenAiFrame('data: {"choices":[],"usage":{"completion_tokens":12}}')?.usage?.completionTokens === 12
)
check(
  'usage 帧不该被当成正文',
  parseOpenAiFrame('data: {"choices":[],"usage":{"completion_tokens":12}}')?.text === ''
)
check(
  '没有 usage 时字段不出现',
  parseOpenAiFrame('data: {"choices":[{"delta":{"content":"a"}}]}')?.usage === undefined
)
check(
  '正文帧也带 usage 时不丢',
  parseOpenAiFrame('data: {"choices":[{"delta":{"content":"a"}}],"usage":{"completion_tokens":5}}')?.usage
    ?.completionTokens === 5
)

// ── 流式聚合 ────────────────────────────────────────────────────────────────
const encoder = new TextEncoder()
let sentBody = null
const stubStream = (chunks) => {
  sentBody = null
  globalThis.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body)
    return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        let index = 0
        return {
          read: async () => (index < chunks.length ? { value: encoder.encode(chunks[index++]), done: false } : { value: undefined, done: true }),
          releaseLock() {},
        }
      },
    },
    }
  }
}

stubStream([
  'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
  'data: [DONE]\n\n',
])
const deltas = []
const result = await streamOpenAiChat(
  { baseUrl: 'https://a.com/v1/', apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }] },
  (delta) => deltas.push(delta.text)
)
check('聚合文本正确', result.text === '你好', result.text)
check('finish_reason 透传', result.finishReason === 'stop')
check('逐段回调', deltas.join('|') === '你|好', deltas.join('|'))

// 测速：include_usage 要真的写进请求体，usage 也要从末帧收上来
stubStream([
  'data: {"choices":[{"delta":{"content":"一"}}]}\n\n',
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
  'data: {"choices":[],"usage":{"completion_tokens":9}}\n\n',
])
const perf = await streamOpenAiChat({
  baseUrl: 'https://a.com/v1',
  apiKey: 'k',
  model: 'm',
  messages: [],
  includeUsage: true,
})
check('include_usage 写进请求体', sentBody?.stream_options?.include_usage === true)
check('usage 聚合到返回值', perf.usage?.completionTokens === 9, JSON.stringify(perf.usage))
check('usage 帧不混进正文', perf.text === '一', perf.text)

// 最后一帧没有空行结尾也要收
stubStream(['data: {"choices":[{"delta":{"content":"尾"}}]}'])
check('无结尾空行时仍收到末帧', (await streamOpenAiChat({ baseUrl: 'https://a.com/v1', apiKey: 'k', model: 'm', messages: [] })).text === '尾')

// 错误路径：必须是 ApiError，界面才会给出「API Key 无效」这类提示，
// 而不是把上游 JSON 原文当成回答贴进对话。
globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })
let failure = null
try {
  await streamOpenAiChat({ baseUrl: 'https://a.com/v1', apiKey: 'k', model: 'm', messages: [] })
} catch (error) {
  failure = error
}
check(
  'HTTP 错误抛 ApiError 并带状态码',
  failure?.name === 'ApiError' && failure.status === 401 && failure.message === 'unauthorized',
  `${failure?.name} ${failure?.message}`,
)

globalThis.fetch = async () => ({
  ok: false,
  status: 401,
  text: async () => JSON.stringify({ error: { message: 'Invalid API key', type: 'AgnesAI_error' } }),
})
failure = null
try {
  await streamOpenAiChat({ baseUrl: 'https://a.com/v1', apiKey: 'k', model: 'm', messages: [] })
} catch (error) {
  failure = error
}
check('上游 error.message 被取出来', failure?.message === 'Invalid API key', String(failure?.message))

globalThis.fetch = async () => {
  throw new TypeError('Failed to fetch')
}
failure = null
try {
  await streamOpenAiChat({ baseUrl: 'https://a.com/v1', apiKey: 'k', model: 'm', messages: [] })
} catch (error) {
  failure = error
}
check('断网归为 network', failure?.kind === 'network', `${failure?.kind} ${failure?.message}`)

let threw = ''

for (const [name, options, expected] of [
  ['空 baseUrl', { baseUrl: '', apiKey: 'k', model: 'm', messages: [] }, 'invalid base url'],
  ['空 Key', { baseUrl: 'https://a.com/v1', apiKey: '  ', model: 'm', messages: [] }, 'missing api key'],
  ['空模型', { baseUrl: 'https://a.com/v1', apiKey: 'k', model: ' ', messages: [] }, 'missing model'],
]) {
  threw = ''
  try {
    await streamOpenAiChat(options)
  } catch (error) {
    threw = String(error.message)
  }
  check(name + ' 抛错', threw === expected, threw)
}

// ── 适配器：块的顺序、思考增量、stop_reason ─────────────────────────────────
const collect = async (chunks) => {
  stubStream(chunks)
  const events = []
  for await (const event of streamThirdPartyChat({
    baseUrl: 'https://a.com/v1',
    apiKey: 'k',
    model: 'm',
    system: '',
    history: [{ role: 'user', content: 'hi' }],
  })) {
    events.push(event)
  }
  return events.map((event) => {
    if (event.type === 'content_block_start') return `start:${event.index}:${event.content_block.type}`
    if (event.type === 'content_block_delta') return `delta:${event.index}:${event.delta.type}`
    if (event.type === 'content_block_stop') return `stop:${event.index}`
    if (event.type === 'message_delta') return `message_delta:${event.delta.stop_reason}`
    return event.type
  })
}

const reasoningShape = await collect([
  'data: {"choices":[{"delta":{"reasoning_content":"想"}}]}\n\n',
  'data: {"choices":[{"delta":{"reasoning_content":"一下"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
  'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
  'data: [DONE]\n\n',
])
check(
  '思考块在正文之前，length 映成 max_tokens',
  reasoningShape.join(' ') ===
    'start:0:thinking delta:0:thinking_delta delta:0:thinking_delta stop:0 start:1:text delta:1:text_delta stop:1 message_delta:max_tokens message_stop',
  reasoningShape.join(' ')
)

const textOnlyShape = await collect([
  'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
  'data: [DONE]\n\n',
])
check(
  '纯正文不带空的思考块',
  textOnlyShape.join(' ') === 'start:0:text delta:0:text_delta stop:0 message_delta:end_turn message_stop',
  textOnlyShape.join(' ')
)

const reasoningOnlyShape = await collect([
  'data: {"choices":[{"delta":{"reasoning_content":"只想不说"}}]}\n\n',
  'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
  'data: [DONE]\n\n',
])
check(
  '只有思考时不发正文块',
  reasoningOnlyShape.join(' ') ===
    'start:0:thinking delta:0:thinking_delta stop:0 message_delta:max_tokens message_stop',
  reasoningOnlyShape.join(' ')
)

const early = []
stubStream([
  'data: {"choices":[{"delta":{"content":"第一段"}}]}\n\n',
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
  'data: [DONE]\n\n',
])
const failureMidStream = (async () => {
  for await (const event of streamThirdPartyChat({
    baseUrl: 'https://a.com/v1',
    apiKey: 'k',
    model: 'm',
    system: '',
    history: [{ role: 'user', content: 'hi' }],
  })) {
    early.push(event.type)
  }
})()
await failureMidStream
check('正常流以 message_stop 收尾', early.at(-1) === 'message_stop' && early[0] === 'content_block_start', early.join(','))

console.log(failed === 0 ? '\n全部通过' : '\n失败 ' + failed + ' 项')
process.exit(failed === 0 ? 0 : 1)
