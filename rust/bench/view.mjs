// Does reply-view construction belong in Rust? `buildReplyView` takes the whole assistant message
// and returns the whole view, so it is the "big object in, big object out" shape.
//
//   powershell -NoProfile -ExecutionPolicy Bypass -File rust/build-web-core.ps1 -Crate view-rs -OutDir "$env:TEMP\bench\view-rs"
//   node --import ./rust/register-ts.mjs rust/bench/view.mjs
import { compare, fromWire, initGlue, installFileFetch, loadTs, summarize } from './lib.mjs'

installFileFetch()
// view.ts -> i18n -> settings reads `window.DeepSeekAndroid` at module scope.
if (!globalThis.window) globalThis.window = {}
if (!globalThis.localStorage) globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const glue = await initGlue('view-rs')
const {
  buildReplyView,
  getAreaTitle,
  getSiteName,
  getTotalThinkingSeconds,
  isDeepSearchKind,
  isImageSearchKind,
} = await loadTs('src/services/chat/view.ts')
// The Rust port of `getAreaTitle` carries the zh-CN catalogue (two strings are hard-coded there),
// so pin the TS side to the same locale instead of comparing across locales.
const { useSettings } = await loadTs('src/services/settings.ts')
useSettings.setState({ locale: 'zh-CN' })

const viaRust = (fn, ...args) => fromWire(glue[fn](...args))

// ---- a heavy research answer: 6 searches, 48 sources, 2 read-links, thinking interleaved ------
const PROSE = [
  '先把结论放在前面：这一层现在最大的成本不是算法，而是每帧都要把整条回复重新推导一遍。',
  '`buildReplyView` 是纯函数，只要入参不变，输出就完全不变；但它没有缓存，所以流式输出的每个增量都会重跑。',
  'The citation registry numbers a URL the first time it appears, so a page that is opened before it is searched gets the lower number.',
  '正文里挂过引用的块之后，服务端会另起一个新块；引用角标就插在被引用块的块尾空白之前，空行仍然保留。',
  '搜索结果按种类聚合到首次出现的位置；边想边搜（deep_search）只合并相邻且同种类的调用，避免两次搜索被并成一块。',
]
const prose = (chars) => {
  let out = ''
  for (let index = 0; out.length < chars; index += 1) out += PROSE[index % PROSE.length]
  return out.slice(0, chars)
}

const resultItem = (seed, index) => ({
  type: 'web_search_result',
  url: `https://docs.example${index % 7}.io/guides/2026/context-budget-${seed}-${index}`,
  title: `上下文预算与缓存命中（${seed}-${index}）— 一个足够长的真实标题，用来测试去重与编号`,
  page_age: `2026-10-${String(10 + (index % 18)).padStart(2, '0')}`,
  snippet: prose(180),
  site_icon: `https://docs.example${index % 7}.io/favicon.ico`,
  site_name: `docs.example${index % 7}.io`,
})

const fetchResult = (block) => ({
  type: 'web_fetch_tool_result',
  tool_use_id: block.id,
  kind: 'read_link',
  signature: `sig-${block.id}-${'k'.repeat(40)}`,
  content: {
    type: 'web_fetch_result',
    url: block.input.url,
    published_at: '2026-10-12',
    content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: prose(400) }, title: `页面标题 ${block.id}` },
  },
})

const blocks = []
let step = 0
const addThinking = (chars) => {
  const startedAt = 1_760_000_000_000 + step * 1000
  blocks.push({ type: 'thinking', thinking: prose(chars), signature: `sig-${step}`, startedAt, endedAt: startedAt + 4_000 + step * 50 })
}
const addText = (chars, citations = 0) => {
  blocks.push({
    type: 'text',
    text: prose(chars),
    citations: Array.from({ length: citations }, (_, index) => ({
      type: 'web_search_result_location',
      url: `https://docs.example${index % 7}.io/guides/2026/context-budget-${step}-${index}`,
      title: `被引用的来源 ${index}`,
      cited_text: prose(60),
      encrypted_index: '',
    })),
  })
}
const addSearch = (kind, queryCount, seed) => {
  const id = `srvtoolu_${seed}`
  const queries = Array.from({ length: queryCount }, (_, index) => `上下文预算 ${seed} 查询 ${index}`)
  blocks.push({ type: 'server_tool_use', id, name: 'web_search', kind, input: { action: 'search', queries } })
  blocks.push({ type: 'web_search_tool_result', tool_use_id: id, content: Array.from({ length: 8 }, (_, index) => resultItem(seed, index)) })
}
for (let round = 0; round < 4; round += 1) {
  addThinking(220)
  addSearch(round % 2 === 0 ? 'search' : 'deep_search', 2 + (round % 2), `s${round}`)
  addText(180, 2)
}
const pageTool = { type: 'server_tool_use', id: 'srvtoolu_open', name: 'web_search', kind: 'search', input: { action: 'open_page', url: 'https://docs.example1.io/guides/2026/context-budget-open' } }
blocks.push(pageTool)
blocks.push(fetchResult(pageTool))
blocks.push({ type: 'server_tool_use', id: 'srvtoolu_find', name: 'web_search', kind: 'search', input: { action: 'find', pattern: 'prefix cache' } })
addThinking(160)
for (const url of ['https://docs.example2.io/a', 'https://docs.example3.io/b']) {
  const link = { type: 'server_tool_use', id: `srvtoolu_link_${step}`, name: 'web_search', kind: 'read_link', input: { action: 'read_link', url } }
  blocks.push(link)
  blocks.push(fetchResult(link))
  addText(240, 1)
}
addSearch('image_search', 1, 'img')
addSearch('deep_image_search', 1, 'dimg')
addText(1_400, 6)

const reply = {
  id: 'msg_bench',
  role: 'assistant',
  status: 'streaming',
  stopReason: null,
  thinking: true,
  search: true,
  createdAt: 1_760_000_000_000,
  updatedAt: 1_760_000_100_000,
  latestReminder: null,
  prefix: true,
  blocks,
}
const replyJson = JSON.stringify(reply)
const settled = JSON.stringify({ ...reply, status: 'done', stopReason: 'end_turn' })
const view = buildReplyView(reply, true)
console.log(
  `# reply: ${blocks.length} blocks, ${replyJson.length} code units of JSON; view: ${view.steps.length} steps, ${view.sources.length} sources, answer=${view.answer ? view.answer.text.length : 0} chars`,
)

const now = 1_760_000_100_000
const results = []
results.push(
  await compare({
    crate: 'view',
    fn: 'buildReplyView@streaming',
    iterations: 300,
    ts: () => buildReplyView(reply, true),
    rust: () => viaRust('buildReplyView', replyJson, true),
  }),
)
results.push(
  await compare({
    crate: 'view',
    fn: 'buildReplyView@settled',
    iterations: 300,
    ts: () => buildReplyView({ ...reply, status: 'done' }, false),
    rust: () => viaRust('buildReplyView', settled, false),
  }),
)
results.push(
  await compare({
    crate: 'view',
    fn: 'getTotalThinkingSeconds',
    iterations: 5000,
    ts: () => getTotalThinkingSeconds(view.steps, now),
    rust: () => viaRust('getTotalThinkingSeconds', JSON.stringify(view.steps), now),
  }),
)
results.push(
  await compare({
    crate: 'view',
    fn: 'getAreaTitle@hasResponse',
    iterations: 5000,
    ts: () => getAreaTitle(view, true, now, true),
    rust: () => viaRust('getAreaTitle', JSON.stringify(view), true, now, 'true'),
  }),
)
results.push(
  await compare({
    crate: 'view',
    fn: 'getSiteName',
    iterations: 20000,
    ts: () => getSiteName('https://www.docs.example1.io/guides/2026/context-budget'),
    rust: () => viaRust('getSiteName', JSON.stringify('https://www.docs.example1.io/guides/2026/context-budget')),
  }),
)
results.push(
  await compare({
    crate: 'view',
    fn: 'isDeepSearchKind',
    iterations: 20000,
    ts: () => isDeepSearchKind('deep_search'),
    rust: () => viaRust('isDeepSearchKind', JSON.stringify('deep_search')),
  }),
)
results.push(
  await compare({
    crate: 'view',
    fn: 'isImageSearchKind',
    iterations: 20000,
    ts: () => isImageSearchKind('image_search'),
    rust: () => viaRust('isImageSearchKind', JSON.stringify('image_search')),
  }),
)
summarize('view', results)
