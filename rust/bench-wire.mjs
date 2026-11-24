// Is the binary wire worth it? Compares, for the same session sizes:
//   typescript      — the original TS implementation
//   json-text       — browser glue, Value marshalled as JSON text (what the current adapters do)
//   binary-wire     — the generated codec, reused in the browser (wDyn encode + generated decode)
//
// usage: node rust/bench-wire.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const repo = new URL('../', import.meta.url)
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(String(input))
  if (url.protocol !== 'file:') return realFetch(input, init)
  return new Response(readFileSync(url), { headers: { 'content-type': 'application/wasm' } })
}

// Build the browser codec from the generated Node glue (same transform as probe-wire.mjs).
const source = readFileSync(new URL('rust/branches-rs/index.cjs', repo), 'utf8')
const factory = `export const createCodec = (native) => {
  const module = { exports: {} }
${source.replace(/^const native = require\([^)]*\)\s*$/m, '')}
  return module.exports
}
`
const factoryPath = join(process.env.TEMP, 'wire-branches-rs.mjs')
writeFileSync(factoryPath, factory)

const glue = await import(new URL('src/rust-core/pkg/branches_rs.js', repo).href)
await glue.default({ module_or_path: new URL('src/rust-core/pkg/branches_rs_bg.wasm', repo) })
const codec = (await import(`file:///${factoryPath.replace(/\\/g, '/')}`)).createCodec(glue)

const { getVisibleMessages } = await import(new URL('src/services/chat/branches.ts', repo).href)
const decodeJson = (raw) => JSON.parse(raw)

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
  for (let index = 0; index < Math.min(iterations, 50); index += 1) run()
  const start = performance.now()
  for (let index = 0; index < iterations; index += 1) run()
  const perOp = (performance.now() - start) / iterations
  console.log(`  ${label.padEnd(26)} ${perOp.toFixed(4)} ms/op`)
  return perOp
}

for (const count of [50, 200, 800]) {
  const session = buildSession(count)
  const json = JSON.stringify(session)
  const expected = JSON.stringify(getVisibleMessages(session))
  const viaJson = JSON.stringify(decodeJson(glue.getVisibleMessages(json)))
  const viaWire = JSON.stringify(codec.getVisibleMessages(session))
  if (expected !== viaJson || expected !== viaWire) {
    console.log(`  MISMATCH at ${count} — refusing to compare timings`)
    process.exit(1)
  }
  console.log(`getVisibleMessages, ${count} messages (~${(json.length / 1024) | 0} KB)`)
  const iterations = count > 400 ? 300 : 2000
  const ts = time('typescript', iterations, () => getVisibleMessages(session))
  const jt = time('json-text path', iterations, () => decodeJson(glue.getVisibleMessages(JSON.stringify(session))))
  const bw = time('binary wire path', iterations, () => codec.getVisibleMessages(session))
  console.log(
    `  -> json-text ${(ts / jt).toFixed(2)}x TS | binary wire ${(ts / bw).toFixed(2)}x TS` +
      ` (${bw < ts ? 'WINS' : 'still slower'})\n`,
  )
}
