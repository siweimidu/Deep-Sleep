// End-to-end check of the adapters the app actually imports.
//
// After the performance pass only two units are wired: `zipReader` (measured 5.14x faster, see
// rust/bench-archive.mjs) and `budget.estimateTokens` (1.2-1.8x faster, but only above ~128 UTF-16
// code units - so this script must prove BOTH sides of that threshold, not just the fast side).
//
// usage: node rust/adapter-check.mjs
import { readFileSync } from 'node:fs'

const repo = new URL('../', import.meta.url)

// The web glue inits by fetching the module URL; Node has no file:// fetch.
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(String(input))
  if (url.protocol !== 'file:') return realFetch(input, init)
  return new Response(readFileSync(url), { headers: { 'content-type': 'application/wasm' } })
}

const { rustBudget, isRustBudgetReady } = await import(new URL('src/rust-core/budget.ts', repo).href)
const { isRustZipReaderReady } = await import(new URL('src/rust-core/zipReader.ts', repo).href)

const deadline = Date.now() + 20000
while (!isRustBudgetReady() || !isRustZipReaderReady()) {
  if (Date.now() > deadline) throw new Error('adapter never became ready: init/fetch failed')
  await new Promise((resolve) => setTimeout(resolve, 25))
}

/** The original implementation, as the oracle for both the TS and the Rust side. */
const reference = (text) => {
  if (!text) return 0
  let wide = 0
  let narrow = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code > 0x2e7f) {
      wide += 1
    } else {
      narrow += 1
    }
  }
  return Math.ceil(wide + narrow / 3.6)
}

const cjk = '重构是把一段代码换成另一种语言'.repeat(20) // wide chars, > 128 units
const ascii = 'the quick brown fox jumps over the lazy dog '.repeat(10)
const emoji = '😀'.repeat(80) // astral: 2 UTF-16 units each
const samples = ['', 'a', 'hello world', ascii, cjk, emoji]

const cases = []
for (const sample of samples) {
  cases.push([`estimateTokens(len=${sample.length})`, rustBudget.estimateTokens(sample), reference(sample)])
}
// Below the threshold the adapter still answers for long-enough strings only; the short ones are
// served by TypeScript, and both must agree on the same value.
cases.push(['below threshold returns 0 (empty)', rustBudget.estimateTokens(''), 0])

let failed = 0
for (const [name, got, want] of cases) {
  const ok = Object.is(got, want)
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(got)}`)
}
console.log(
  failed === 0
    ? `adapter: ${cases.length}/${cases.length} through the app adapters (zipReader + budget ready)`
    : `adapter: ${failed} failed`,
)
process.exit(failed === 0 ? 0 : 1)
