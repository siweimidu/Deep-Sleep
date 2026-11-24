// Does context budgeting belong in Rust? `estimateTokens` (pure string loop) and `planContext`
// (whole history in, whole history out).
//
//   powershell -NoProfile -ExecutionPolicy Bypass -File rust/build-web-core.ps1 -Crate budget-rs -OutDir "$env:TEMP\bench\budget-rs"
//   node --import ./rust/register-ts.mjs rust/bench/budget.mjs
import { compare, fromWire, initGlue, installFileFetch, loadTs, summarize } from './lib.mjs'

installFileFetch()
// budget.ts -> view.ts -> i18n -> settings, which reads `window.DeepSeekAndroid` at module scope.
// Node has no window; an empty one is enough for a pure-computation benchmark.
if (!globalThis.window) globalThis.window = {}
if (!globalThis.localStorage) globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
const glue = await initGlue('budget-rs')
const { estimateTokens, planContext } = await loadTs('src/services/chat/context/budget.ts')

const viaRust = (fn, ...args) => fromWire(glue[fn](...args))

// ---- estimateTokens: one paragraph of the prose this app actually produces -------------------
// Chinese prose with Latin terms and inline code, i.e. mixed wide/narrow, plus one emoji pair so
// the code-point loop is exercised on an astral character too.
const LINES = [
  '先说结论：把估算挪到 Rust 只有在输入足够大时才成立，因为每次调用都要把整串复制过去一遍。',
  'The per-code-unit loop itself is cheap — a few hundred nanoseconds per kilobyte — so at 1 KB the boundary is the whole cost.',
  '这一节有两段代码要对齐：`for (const char of text)` 按码点迭代，Rust 侧对应 `text.chars()`；两侧都先跳过空串。',
  '按 3.6 字符一个 token 折算，100 KB 的英文大约 28k token，同样体量的中文大约 100k，差距全在 `code > 0x2e7f` 这一支。',
  'Cache hit ratio 稳定在 87% 左右，前缀没变的部分不进请求体，所以这一层的成本主要落在客户端。',
  '在 WebView 里跑记得 wasm 的线性内存是共用的，`rustAnythingWireMemory` 拿到的就是同一块。',
  '附件一律按固定预算折算，避免为一两张图片反复解析，这种情况在长会话里很常见 🧮。',
]
const makeText = (codeUnits) => {
  let out = ''
  for (let index = 0; out.length < codeUnits; index += 1) {
    out += `${LINES[index % LINES.length]}\n\n`
  }
  return out.slice(0, codeUnits)
}

// Built ONCE. Rebuilding inside the timing loop would charge both sides for string assembly and
// hide the only difference that matters (the scan plus the boundary copy).
const TEXTS = { '1KB': makeText(1_000), '100KB': makeText(100_000), '1MB': makeText(1_000_000) }
// Same length, every code unit narrow: exercises the branch the wide text never takes.
const ASCII = TEXTS['1MB'].replace(/[^\x00-\x7f]/g, 'x')
for (const [label, text] of [...Object.entries(TEXTS), ['1MB-ascii', ASCII]]) {
  console.log(
    `# estimateTokens@${label}: ${text.length} UTF-16 code units, ${Buffer.byteLength(text, 'utf8')} UTF-8 bytes, tokens=${estimateTokens(text)}`,
  )
}

// ---- planContext: a realistic long session ---------------------------------------------------
const toolResult = (id, index) => ({
  type: 'web_search_tool_result',
  tool_use_id: id,
  content: Array.from({ length: 8 }, (_, item) => ({
    type: 'web_search_result',
    url: `https://example${item}.com/blog/2026/context-budget-${index}`,
    title: `上下文预算与缓存命中（第 ${index} 期，结果 ${item + 1}）— 长标题用来占位，和真实搜索返回的一样长`,
    page_age: '2026-10-1' + (item % 9),
    snippet:
      '前缀缓存命中率取决于请求体前缀是否逐字节一致；裁剪点之间保持完全一致，才能让优惠真的落到账单上。'.repeat(2),
    site_name: `example${item}.com`,
  })),
})

const makeHistory = (rounds) => {
  const history = []
  for (let index = 0; index < rounds; index += 1) {
    history.push({
      id: `u${index}`,
      role: 'user',
      content: makeText(600 + (index % 5) * 120),
      createdAt: 1_760_000_000_000 + index * 60_000,
      files: index % 11 === 0 ? [{ id: `f${index}`, serverId: `file-${index}`, name: 'diagram.png', size: 240_000, isImage: true }] : [],
    })
    const searchId = `srvtoolu_${index}`
    history.push({
      id: `a${index}`,
      role: 'assistant',
      status: 'done',
      stopReason: 'end_turn',
      thinking: index % 3 === 0,
      createdAt: 1_760_000_030_000 + index * 60_000,
      blocks: [
        { type: 'thinking', thinking: makeText(400), signature: `sig-${index}`, startedAt: 1_760_000_030_000, endedAt: 1_760_000_036_000 },
        ...(index % 3 === 0
          ? [
              { type: 'server_tool_use', id: searchId, name: 'web_search', kind: index % 2 === 0 ? 'search' : 'deep_search', input: { action: 'search', queries: [`上下文预算 ${index}`, 'context budget cache hit'] } },
              toolResult(searchId, index),
            ]
          : []),
        { type: 'text', text: makeText(900 + (index % 4) * 200), citations: [] },
      ],
    })
  }
  return history
}

const history = makeHistory(40)
const historyJson = JSON.stringify(history)
console.log(
  `# planContext history: 40 rounds / ${history.length} messages, ${historyJson.length} code units of JSON (${Buffer.byteLength(historyJson, 'utf8')} bytes)`,
)

// question-shaped tail: planContext is always called with the session it is about to send
const results = []
for (const [label, fn, iterations, ts, rust] of [
  ['estimateTokens@empty', 'estimateTokens', 20000, () => estimateTokens(''), () => glue.estimateTokens('')],
  ['estimateTokens@1KB', 'estimateTokens', 5000, () => estimateTokens(TEXTS['1KB']), () => glue.estimateTokens(TEXTS['1KB'])],
  ['estimateTokens@100KB', 'estimateTokens', 100, () => estimateTokens(TEXTS['100KB']), () => glue.estimateTokens(TEXTS['100KB'])],
  ['estimateTokens@1MB', 'estimateTokens', 20, () => estimateTokens(TEXTS['1MB']), () => glue.estimateTokens(TEXTS['1MB'])],
  ['estimateTokens@1MB-ascii', 'estimateTokens', 20, () => estimateTokens(ASCII), () => glue.estimateTokens(ASCII)],
  [
    'planContext@40rounds',
    'planContext',
    60,
    () => planContext(history, 'deepseek-v4-pro'),
    () => viaRust('planContext', historyJson, 'deepseek-v4-pro'),
  ],
  [
    'planContext@40rounds+measured',
    'planContext',
    60,
    () => planContext(history, 'deepseek-v4-pro', 95_000),
    () => viaRust('planContext', historyJson, 'deepseek-v4-pro', 95_000),
  ],
  [
    'planContext@40rounds+measured/flash',
    'planContext',
    60,
    () => planContext(history, 'deepseek-flash', 700_000),
    () => viaRust('planContext', historyJson, 'deepseek-flash', 700_000),
  ],
]) {
  results.push(await compare({ crate: 'budget', fn: label, iterations, ts, rust }))
}
summarize('budget', results)
