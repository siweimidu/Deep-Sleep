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
// The small sizes locate the crossover; 1 KB / 100 KB / 1 MB are the regimes the task asks about.
const SIZES = [
  ['16', 16],
  ['64', 64],
  ['128', 128],
  ['256', 256],
  ['512', 512],
  ['1KB', 1_000],
  ['100KB', 100_000],
  ['1MB', 1_000_000],
]
const TEXTS = Object.fromEntries(SIZES.map(([label, codeUnits]) => [label, makeText(codeUnits)]))
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
const ITERATIONS = { '16': 20000, '64': 20000, '128': 20000, '256': 20000, '512': 20000, '1KB': 5000, '100KB': 100, '1MB': 20 }
const tokenCases = [['empty', '', 20000]]
for (const [label, text] of Object.entries(TEXTS)) tokenCases.push([label, text, ITERATIONS[label]])
tokenCases.push(['1MB-ascii', ASCII, 20])
for (const [label, text, iterations] of tokenCases) {
  results.push(
    await compare({ crate: 'budget', fn: `estimateTokens@${label}`, iterations, ts: () => estimateTokens(text), rust: () => glue.estimateTokens(text) }),
  )
}
const planCases = [
  {
    label: 'planContext@40rounds',
    ts: () => planContext(history, 'deepseek-v4-pro'),
    rust: () => viaRust('planContext', historyJson, 'deepseek-v4-pro'),
  },
  {
    label: 'planContext@40rounds+measured',
    ts: () => planContext(history, 'deepseek-v4-pro', 95_000),
    rust: () => viaRust('planContext', historyJson, 'deepseek-v4-pro', 95_000),
  },
  {
    label: 'planContext@40rounds+measured/flash',
    ts: () => planContext(history, 'deepseek-flash', 700_000),
    rust: () => viaRust('planContext', historyJson, 'deepseek-flash', 700_000),
  },
]
for (const { label, ts, rust } of planCases) {
  results.push(await compare({ crate: 'budget', fn: label, iterations: 60, ts, rust }))
}
summarize('budget', results)
