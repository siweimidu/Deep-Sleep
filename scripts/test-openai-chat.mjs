// OpenAI 兼容客户端：消息转换、SSE 帧解析、流式聚合（fetch 用桩，不联网）。
// 运行：node --experimental-transform-types --no-warnings --import ./rust/register-ts.mjs scripts/test-openai-chat.mjs
import { toOpenAiMessages, parseOpenAiFrame, streamOpenAiChat } from '../src/services/api/openaiChat.ts'

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

// ── 流式聚合 ────────────────────────────────────────────────────────────────
const encoder = new TextEncoder()
const stubStream = (chunks) => {
  globalThis.fetch = async () => ({
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
  })
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

// 最后一帧没有空行结尾也要收
stubStream(['data: {"choices":[{"delta":{"content":"尾"}}]}'])
check('无结尾空行时仍收到末帧', (await streamOpenAiChat({ baseUrl: 'https://a.com/v1', apiKey: 'k', model: 'm', messages: [] })).text === '尾')

// 错误路径
globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })
let threw = ''
try {
  await streamOpenAiChat({ baseUrl: 'https://a.com/v1', apiKey: 'k', model: 'm', messages: [] })
} catch (error) {
  threw = String(error.message)
}
check('HTTP 错误带状态码与正文', threw === 'HTTP 401 unauthorized', threw)

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

console.log(failed === 0 ? '\n全部通过' : '\n失败 ' + failed + ' 项')
process.exit(failed === 0 ? 0 : 1)
