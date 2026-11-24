// End-to-end check of the app's adapter (`src/rust-core/paths.ts`), not just the raw wasm glue.
//
// web-parity.mjs proves the crate's functions match the original; it does not exercise the adapter
// the app actually imports (the `$undefined`-free `JSON.parse` step, the ready gate, the fallback).
// This runs that module for real: a fetch shim serves the wasm from disk so the browser-target
// `init()` succeeds, then the asserted values are the ones the original TS produced.
//
// usage: node rust/adapter-check.mjs
import { readFileSync } from 'node:fs'

const repo = new URL('../', import.meta.url)

// The web-target glue inits by fetching the module URL; Node has no file:// fetch.
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(String(input))
  if (url.protocol !== 'file:') return realFetch(input, init)
  const bytes = readFileSync(url)
  return new Response(bytes, { headers: { 'content-type': 'application/wasm' } })
}

const { rustPaths } = await import(new URL('src/rust-core/paths.ts', repo).href)

// The adapter loads in the background; give it until it reports ready.
const deadline = Date.now() + 15000
while (rustPaths.parseSessionPath('probe') === undefined) {
  if (Date.now() > deadline) throw new Error('adapter never became ready: init/fetch failed')
  await new Promise((resolve) => setTimeout(resolve, 25))
}

const cases = [
  ['sessionPath', rustPaths.sessionPath('s1'), 'chat_sessions/s1.json'],
  ['sessionFilesDir', rustPaths.sessionFilesDir('s1'), 'chat_sessions/s1_files/'],
  ['parseSessionPath hit', rustPaths.parseSessionPath('chat_sessions/a.json'), 'a'],
  ['parseSessionPath dotted', rustPaths.parseSessionPath('chat_sessions/a.json.json'), 'a.json'],
  ['parseSessionPath miss', rustPaths.parseSessionPath('chat_sessions/.json'), null],
  ['parseSessionPath other', rustPaths.parseSessionPath('other/a.json'), null],
  ['imagePath separators', rustPaths.imagePath('s', 'a/b', 'c\\d'), 'chat_sessions/s_files/a_b_c_d'],
  ['imagePath reserved', rustPaths.imagePath('s', '..', ''), 'chat_sessions/s_files/unnamed_unnamed'],
  ['imagePath NFC', rustPaths.imagePath('s', 'f', 'e\u0301.png'), 'chat_sessions/s_files/f_\u00e9.png'],
]

let failed = 0
for (const [name, got, want] of cases) {
  const ok = Object.is(got, want)
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(got)}`)
}
console.log(failed === 0 ? `adapter: ${cases.length}/${cases.length} through the app adapter` : `adapter: ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
