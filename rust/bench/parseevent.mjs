// Does stream-event validation belong in Rust? `readMessageEvent` against the TS function.
//
//   powershell -NoProfile -ExecutionPolicy Bypass -File rust/build-web-core.ps1 -Crate parseevent-rs -OutDir "$env:TEMP\bench\parseevent-rs"
//   node --import ./rust/register-ts.mjs rust/bench/parseevent.mjs
import { compare, fromWire, initGlue, installFileFetch, loadTs, summarize } from './lib.mjs'

installFileFetch()
const glue = await initGlue('parseevent-rs')
const { readMessageEvent } = await loadTs('src/services/api/parseEvent.ts')

// `serde_json::Value` in and out: the argument is JSON text, the result is JSON text (§4).
const viaRust = async (value) => fromWire(await glue.readMessageEvent(JSON.stringify(value)))

const citation = (index) => ({
  type: 'web_search_result_location',
  url: `https://www.deepseek.com/research/note-${index}`,
  title: `DeepSeek 技术报告第 ${index} 节`,
  cited_text: '把显存中的 KV cache 按页管理，可以显著降低长上下文的占用。',
})

const messageStart = {
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
}

// A text block that opens with citations the server already attached, two of them malformed.
const blockStart = {
  type: 'content_block_start',
  index: 0,
  content_block: {
    type: 'text',
    text: '',
    citations: [
      citation(1),
      citation(2),
      { type: 'web_search_result_location', url: 42, title: 'bad url' },
      { type: 'news_result', url: 'https://example.com/x', title: 'wrong type' },
      citation(3),
      citation(4),
      citation(5),
    ],
  },
}

const blockDelta = {
  type: 'content_block_delta',
  index: 0,
  delta: {
    type: 'text_delta',
    text: 'Rust 的所有权模型把内存安全放在编译期解决，运行时不需要垃圾回收器。',
  },
}

const messageDelta = {
  type: 'message_delta',
  delta: { stop_reason: 'end_turn', stop_sequence: null, title: '长上下文里的 KV cache 管理' },
  usage: { output_tokens: 356 },
}

const messageStop = { type: 'message_stop' }
const ping = { type: 'ping' }

const results = []
for (const [fn, value] of [
  ['message_start', messageStart],
  ['content_block_start.citations', blockStart],
  ['content_block_delta', blockDelta],
  ['message_delta', messageDelta],
  ['message_stop', messageStop],
  ['reject.ping', ping],
]) {
  results.push(
    await compare({
      crate: 'parseevent',
      fn,
      iterations: 5000,
      ts: async () => readMessageEvent(value),
      rust: async () => viaRust(value),
    }),
  )
}
summarize('parseevent', results)
