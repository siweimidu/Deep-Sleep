// Does session-tree work belong in Rust? Exemplar for the per-crate benches.
//
//   powershell -NoProfile -ExecutionPolicy Bypass -File rust/build-web-core.ps1 -Crate branches-rs -OutDir "$env:TEMP\bench\branches-rs"
//   node --import ./rust/register-ts.mjs rust/bench/branches.mjs
import { compare, fromWire, initGlue, installFileFetch, loadTs, summarize } from './lib.mjs'

installFileFetch()
const glue = await initGlue('branches-rs')
const { getVisibleMessages, normalizeSession } = await loadTs('src/services/chat/branches.ts')

// The glue returns JSON text for serde_json::Value results (ADOPTION.md §4).
const viaRust = async (name, ...args) => fromWire(await glue[name](...args))

const buildSession = (count) => {
  const content = 'lorem ipsum dolor sit amet '.repeat(8)
  const messages = Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content,
    createdAt: index,
    parentId: index === 0 ? null : `m${index - 1}`,
    selectedChildId: index === count - 1 ? undefined : `m${index + 1}`,
  }))
  return { id: 's1', title: 'bench', createdAt: 0, updatedAt: 0, messages, rootMessageId: 'm0' }
}

const linear = buildSession(200)

const results = []
results.push(
  await compare({
    crate: 'branches',
    fn: 'getVisibleMessages',
    iterations: 1000,
    ts: async () => getVisibleMessages(linear),
    rust: async () => viaRust('getVisibleMessages', JSON.stringify(linear)),
  }),
)
results.push(
  await compare({
    crate: 'branches',
    fn: 'normalizeSession',
    iterations: 1000,
    ts: async () => normalizeSession(linear),
    rust: async () => viaRust('normalizeSession', JSON.stringify(linear)),
  }),
)
summarize('branches', results)
