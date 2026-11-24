// Does reply-state handling belong in Rust? `applyEvent` runs once per streamed delta (hot), the
// rest run once per turn; several are so small that the boundary can only lose.
//
//   powershell -NoProfile -ExecutionPolicy Bypass -File rust/build-web-core.ps1 -Crate reply-rs -OutDir "$env:TEMP\bench\reply-rs"
//   node --import ./rust/register-ts.mjs rust/bench/reply.mjs
import { compare, fromWire, initGlue, installFileFetch, loadTs, summarize } from './lib.mjs'

installFileFetch()
if (!globalThis.window) globalThis.window = {}
if (!globalThis.localStorage) globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const glue = await initGlue('reply-rs')
const {
  applyEvent,
  canContinueReply,
  getContextRounds,
  getReplyText,
  getThinkingSeconds,
  settleReply,
  toRequestMessages,
} = await loadTs('src/services/chat/reply.ts')

const viaRust = (fn, ...args) => fromWire(glue[fn](...args))
// The adapter's job (ADOPTION.md §4): a Map has no JSON form, so it crosses as the `$map` marker.
const encodeIndexes = (indexes) => JSON.stringify({ $map: [...indexes].map(([from, to]) => [from, to]) })
const UNDEFINED = '{"$undefined":true}'

const PROSE = [
  '这一层的成本主要在每帧重建整条回复，而不是在单次追加；流式输出越密集，重复推导就越多。',
  '`applyEvent` 只追加可识别的块，跳过的块不占位；续写时内容直接接在已有正文之后。',
  'A signature delta arrives after the thinking text has finished, and carries the message id of this response.',
  '思考块结束前必须补上 `endedAt`，否则界面上那一行会一直显示「正在思考」。',
  '被安全拒绝的轮次不回传：已下发的正文要按协议丢弃，只保留工具块。',
]
const prose = (chars) => {
  let out = ''
  for (let index = 0; out.length < chars; index += 1) out += PROSE[index % PROSE.length]
  return out.slice(0, chars)
}

// ---- a realistic mid-stream reply: thinking + searches + a long body still being written ------
const blocks = []
for (let round = 0; round < 6; round += 1) {
  const startedAt = 1_760_000_000_000 + round * 2000
  blocks.push({ type: 'thinking', thinking: prose(300), signature: `sig-${round}`, startedAt, endedAt: startedAt + 3200 })
  const id = `srvtoolu_${round}`
  blocks.push({
    type: 'server_tool_use',
    id,
    name: 'web_search',
    kind: round % 2 === 0 ? 'search' : 'deep_search',
    input: { action: 'search', queries: ['上下文预算 缓存命中', `prefix cache ${round}`] },
  })
  blocks.push({
    type: 'web_search_tool_result',
    tool_use_id: id,
    content: Array.from({ length: 8 }, (_, item) => ({
      type: 'web_search_result',
      url: `https://docs.example${item}.io/guides/${round}`,
      title: `来源 ${round}-${item} 的长标题，和真实搜索返回的一样长`,
      page_age: '2026-10-1' + (item % 9),
      snippet: prose(200),
      site_icon: `https://docs.example${item}.io/favicon.ico`,
      site_name: `docs.example${item}.io`,
    })),
  })
  blocks.push({ type: 'text', text: prose(200 + round * 40), citations: [] })
}
const readLink = { type: 'server_tool_use', id: 'srvtoolu_link', name: 'web_search', kind: 'read_link', input: { action: 'read_link', url: 'https://docs.example1.io/page' } }
blocks.push(readLink)
blocks.push({
  type: 'web_fetch_tool_result',
  tool_use_id: readLink.id,
  kind: 'read_link',
  signature: `sig-${'k'.repeat(60)}`,
  content: {
    type: 'web_fetch_result',
    url: readLink.input.url,
    published_at: '2026-10-12',
    content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: '' }, title: '被阅读的页面' },
  },
})
blocks.push({ type: 'text', text: prose(1_200), citations: [] })

const streamingReply = {
  id: 'msg_stream',
  role: 'assistant',
  status: 'streaming',
  stopReason: null,
  thinking: true,
  search: true,
  prefix: true,
  createdAt: 1_760_000_000_000,
  updatedAt: 1_760_000_100_000,
  blocks,
}
const streamingJson = JSON.stringify(streamingReply)
console.log(`# streaming reply: ${blocks.length} blocks, ${streamingJson.length} code units of JSON`)

// The delta targets the last text block, which is block index 23 of 24.
const indexes = new Map([[23, blocks.length - 1]])
const indexesJson = encodeIndexes(indexes)
const delta = { type: 'content_block_delta', index: 23, delta: { type: 'text_delta', text: '流式输出继续追加上来的一小段正文。' } }
const deltaJson = JSON.stringify(delta)
const thinkingDelta = { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '继续推理下去……' } }
const thinkingIndexes = new Map([[0, 0]])
const messageDelta = {
  type: 'message_delta',
  delta: { stop_reason: 'end_turn', stop_sequence: null },
  usage: { input_tokens: 48_000, output_tokens: 1_200 },
}

// ---- the same session shape toRequestMessages / getContextRounds consume ----------------------
const reminder = '用户偏好 macOS，命令示例不要用 PowerShell；回答保持中文，代码块标注语言。'
const makeHistory = (rounds) => {
  const history = []
  for (let index = 0; index < rounds; index += 1) {
    history.push({
      id: `u${index}`,
      role: 'user',
      content: prose(500) + (index % 4 === 0 ? '' : `（第 ${index} 轮追问）`),
      createdAt: 1_760_000_000_000 + index * 60_000,
      files: index % 9 === 0 ? [{ id: `f${index}`, serverId: `file-${index}`, name: 'shot.png', size: 180_000, isImage: false }] : [],
    })
    const replyBlocks = [{ type: 'thinking', thinking: prose(260), signature: `sig-${index}`, startedAt: 1_760_000_030_000, endedAt: 1_760_000_034_000 }]
    if (index % 3 === 0) {
      const id = `srvtoolu_h${index}`
      replyBlocks.push({ type: 'server_tool_use', id, name: 'web_search', kind: 'read_link', input: { action: 'read_link', url: `https://docs.example${index % 5}.io/page-${index}` } })
      replyBlocks.push({
        type: 'web_fetch_tool_result',
        tool_use_id: id,
        kind: 'read_link',
        signature: `sig-h${index}-${'k'.repeat(40)}`,
        content: { type: 'web_fetch_result', url: `https://docs.example${index % 5}.io/page-${index}`, published_at: '2026-10-01', content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: '' }, title: `页面 ${index}` } },
      })
    }
    if (index % 3 === 1) {
      const id = `srvtoolu_s${index}`
      replyBlocks.push({ type: 'server_tool_use', id, name: 'web_search', kind: 'search', input: { action: 'search', queries: [`查询 ${index}`] } })
      replyBlocks.push({ type: 'web_search_tool_result', tool_use_id: id, content: [{ type: 'web_search_result', url: `https://docs.example.io/s${index}`, title: `来源 ${index}`, page_age: '2026-09-30', snippet: prose(150), site_name: 'docs.example.io' }] })
    }
    replyBlocks.push({ type: 'text', text: prose(700 + (index % 4) * 150), citations: [], ...(index % 5 === 0 ? { isTemplate: false } : {}) })
    history.push({
      id: `a${index}`,
      role: 'assistant',
      status: 'done',
      stopReason: index % 7 === 3 ? 'max_tokens' : 'end_turn',
      thinking: index % 2 === 0,
      createdAt: 1_760_000_030_000 + index * 60_000,
      parallelToolCalls: true,
      stopDetails: index % 7 === 3 ? { type: 'max_tokens', category: 'output' } : undefined,
      latestReminder: index === 0 ? reminder : undefined,
      blocks: replyBlocks,
    })
  }
  return history
}

const history = makeHistory(40)
const historyJson = JSON.stringify(history)
console.log(`# history: 40 rounds / ${history.length} messages, ${historyJson.length} code units of JSON`)
const question = { id: 'q', role: 'user', content: prose(300), createdAt: 1_760_000_200_000, files: [] }
const questionJson = JSON.stringify(question)
const prefixReply = { ...streamingReply, status: 'stopped', blocks: [{ type: 'text', text: prose(400), citations: [] }] }
const prefixJson = JSON.stringify(prefixReply)

const now = 1_760_000_100_000
const results = []
results.push(
  await compare({
    crate: 'reply',
    fn: 'applyEvent@text_delta',
    iterations: 2000,
    ts: () => applyEvent(streamingReply, delta, now, indexes),
    rust: () => viaRust('applyEvent', streamingJson, deltaJson, now, indexesJson),
  }),
)
results.push(
  await compare({
    crate: 'reply',
    fn: 'applyEvent@thinking_delta',
    iterations: 2000,
    ts: () => applyEvent(streamingReply, thinkingDelta, now, thinkingIndexes),
    rust: () => viaRust('applyEvent', streamingJson, JSON.stringify(thinkingDelta), now, encodeIndexes(thinkingIndexes)),
  }),
)
results.push(
  await compare({
    crate: 'reply',
    fn: 'applyEvent@message_delta',
    iterations: 2000,
    ts: () => applyEvent(streamingReply, messageDelta, now, new Map()),
    rust: () => viaRust('applyEvent', streamingJson, JSON.stringify(messageDelta), now, encodeIndexes([])),
  }),
)
results.push(
  await compare({
    crate: 'reply',
    fn: 'settleReply',
    iterations: 1000,
    ts: () => settleReply(streamingReply, 'done', now),
    rust: () => viaRust('settleReply', streamingJson, JSON.stringify('done'), now, UNDEFINED),
  }),
)
results.push(
  await compare({
    crate: 'reply',
    fn: 'getReplyText',
    iterations: 1000,
    ts: () => getReplyText(streamingReply),
    rust: () => viaRust('getReplyText', streamingJson),
  }),
)
results.push(
  await compare({
    crate: 'reply',
    fn: 'canContinueReply@realistic',
    iterations: 10000,
    ts: () => canContinueReply(prefixReply),
    rust: () => viaRust('canContinueReply', prefixJson),
  }),
)
results.push(
  await compare({
    crate: 'reply',
    fn: 'getContextRounds@40rounds',
    iterations: 1000,
    ts: () => getContextRounds(history),
    rust: () => viaRust('getContextRounds', historyJson),
  }),
)
results.push(
  await compare({
    crate: 'reply',
    fn: 'toRequestMessages@40rounds',
    iterations: 300,
    ts: () => toRequestMessages(history, question),
    rust: () => viaRust('toRequestMessages', historyJson, questionJson, 'null', 'false', UNDEFINED),
  }),
)
results.push(
  await compare({
    crate: 'reply',
    fn: 'toRequestMessages@40rounds+prefix',
    iterations: 300,
    ts: () => toRequestMessages(history, question, prefixReply, true),
    rust: () => viaRust('toRequestMessages', historyJson, questionJson, prefixJson, 'true', UNDEFINED),
  }),
)
results.push(
  await compare({
    crate: 'reply',
    fn: 'getThinkingSeconds',
    iterations: 20000,
    ts: () => getThinkingSeconds(1_760_000_000_000, 1_760_000_012_800),
    rust: () => viaRust('getThinkingSeconds', 1_760_000_000_000, 1_760_000_012_800),
  }),
)
summarize('reply', results)
