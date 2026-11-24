// Measures whether crossing the wasm boundary is worth it, per call shape.
//
// The browser glue marshals a `serde_json::Value` as JSON **text**, so calling a session-level
// transform from the app costs a stringify of the whole session plus a parse of the result. That is
// an O(messages) pass with a much bigger constant than the tree walk it wraps. This script measures
// that instead of guessing, for a cheap string function and for a whole-session transform.
//
// usage: node rust/bench-boundary.mjs
import { readFileSync } from 'node:fs'

const repo = new URL('../', import.meta.url)
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(String(input))
  if (url.protocol !== 'file:') return realFetch(input, init)
  return new Response(readFileSync(url), { headers: { 'content-type': 'application/wasm' } })
}

const init = async (module) => {
  const glue = await import(new URL(`src/rust-core/pkg/${module}.js`, repo).href)
  await glue.default({ module_or_path: new URL(`src/rust-core/pkg/${module}_bg.wasm`, repo) })
  return glue
}

const { getVisibleMessages } = await import(new URL('src/services/chat/branches.ts', repo).href)
// `src/services/attachments.ts` also imports the upload client, which Node cannot resolve from
// source, so replicate the two-line body it delegates with.
const getFileExt = (name) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}
const wasmAttachments = await init('attachments_rs')
const wasmBranches = await init('branches_rs')

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

const time = (label, iterations, run) => {
  for (let index = 0; index < Math.min(iterations, 50); index += 1) run() // warm up
  const start = performance.now()
  for (let index = 0; index < iterations; index += 1) run()
  const perOp = (performance.now() - start) / iterations
  console.log(`  ${label.padEnd(40)} ${perOp.toFixed(4)} ms/op`)
  return perOp
}

console.log('cheap call: getFileExt("photo.PNG") — string in, string out')
const cheapTs = time('typescript', 20000, () => getFileExt('photo.PNG'))
const cheapRust = time('rust (string boundary)', 20000, () =>
  JSON.parse(wasmAttachments.getFileExt('photo.PNG')),
)
console.log(`  -> rust ${(cheapTs / cheapRust).toFixed(2)}x the TS time\n`)

for (const count of [50, 200, 800]) {
  const session = buildSession(count)
  const json = JSON.stringify(session)
  const expected = JSON.stringify(getVisibleMessages(session))
  const actual = JSON.stringify(JSON.parse(wasmBranches.getVisibleMessages(json)))
  if (expected !== actual) {
    console.log(`  MISMATCH at ${count} messages — refusing to compare timings`)
    process.exit(1)
  }
  const size = (json.length / 1024) | 0
  console.log(`session transform: getVisibleMessages, ${count} messages (~${size} KB of JSON)`)
  const iterations = count > 400 ? 100 : 1000
  const ts = time('typescript', iterations, () => getVisibleMessages(session))
  // The honest cost for the app: it holds the object, so it stringifies on every call.
  const rust = time('rust (stringify + call + parse)', iterations, () =>
    JSON.parse(wasmBranches.getVisibleMessages(JSON.stringify(session))),
  )
  console.log(`  -> rust ${(ts / rust).toFixed(2)}x the TS time (${rust > ts ? 'SLOWER' : 'faster'})\n`)
}
