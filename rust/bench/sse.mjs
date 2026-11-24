// Does SSE decoding belong in Rust? `ServerSentEventDecoder` (push/end) against the TS class.
//
//   powershell -NoProfile -ExecutionPolicy Bypass -File rust/build-web-core.ps1 -Crate sse-rs -OutDir "$env:TEMP\bench\sse-rs"
//   node --import ./rust/register-ts.mjs rust/bench/sse.mjs
import { compare, fromWire, initGlue, installFileFetch, loadTs, summarize } from './lib.mjs'

installFileFetch()
const glue = await initGlue('sse-rs')
const { ServerSentEventDecoder } = await loadTs('src/services/api/sse.ts')

// One assistant turn as the API streams it: message_start with usage, a text block, its deltas,
// message_delta with stop_reason, message_stop. CRLF line endings, `: keep-alive` in between.
const frame = (event, data) => `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`

const sentences = [
  'Rust 的所有权模型把内存安全放在编译期解决，',
  '所以运行时不需要垃圾回收器，',
  '这也意味着延迟更加可预测。\n\n',
  '在网络服务里，这一点体现为更稳定的尾延迟：',
  '没有 GC 停顿，P99 与 P50 的差距通常更小。',
  '代价是学习曲线较陡，',
  '尤其是生命周期标注与借用检查器给出的报错。',
]

const deltas = Array.from({ length: 40 }, (_, index) => frame('content_block_delta', {
  type: 'content_block_delta',
  index: 0,
  delta: { type: 'text_delta', text: sentences[index % sentences.length] },
}))

const stream = [
  frame('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_01Kcz5VdYcWq7Jx8pBq9m3nT',
      type: 'message',
      role: 'assistant',
      model: 'deepseek-v3.2',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 4382,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 2048,
        output_tokens: 1,
      },
    },
  }),
  frame('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  }),
  ...deltas.flatMap((delta, index) => (index % 10 === 9 ? [': keep-alive\r\n\r\n', delta] : [delta])),
  frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
  frame('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 356 },
  }),
  frame('message_stop', { type: 'message_stop' }),
].join('')

// Chunks as they arrive off the socket: fixed-size reads, plus one read that lands between the CR
// and the LF of a CRLF pair.
const cuts = new Set()
for (let at = 700; at < stream.length; at += 700) cuts.add(at)
cuts.add(stream.indexOf('\r\n') + 1)
const chunks = []
let from = 0
for (const at of [...cuts].sort((a, b) => a - b)) {
  chunks.push(stream.slice(from, at))
  from = at
}
chunks.push(stream.slice(from))

const splitCrlf = chunks.filter((chunk) => chunk.endsWith('\r')).length
console.log(`# stream ${stream.length} bytes in ${chunks.length} chunks, ${splitCrlf} split across a CRLF`)

const decodeTs = () => {
  const decoder = new ServerSentEventDecoder()
  const events = []
  for (const chunk of chunks) events.push(...decoder.push(chunk))
  events.push(...decoder.end())
  return events
}

const decodeRust = () => {
  const decoder = new glue.ServerSentEventDecoder()
  const events = []
  for (const chunk of chunks) events.push(...fromWire(decoder.push(chunk)))
  events.push(...fromWire(decoder.end()))
  return events
}

const results = []
results.push(
  await compare({
    crate: 'sse',
    fn: 'decodeStream',
    iterations: 1000,
    ts: async () => decodeTs(),
    rust: async () => decodeRust(),
  }),
)
summarize('sse', results)
