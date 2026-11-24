// Is parsing a whole archive faster in Rust? This is the last call shape that could plausibly win:
// bytes in, heavy work, small output. (Whole-object transforms lost by 30-91x, see bench-boundary /
// bench-wire.)
//
//   node --import ./rust/record-shim.mjs --import ./rust/register-ts.mjs rust/bench-archive.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repo = new URL('../', import.meta.url)
const zipPath = join(process.env.TEMP, 'arch.zip')
const bytes = readFileSync(zipPath)
const base64 = bytes.toString('base64')

// Install the fetch shim BEFORE importing any app module: the adapter starts its wasm init at
// import time and only tries once, so a shim installed later leaves it permanently on the TS path.
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(String(input))
  if (url.protocol !== 'file:') return realFetch(input, init)
  return new Response(readFileSync(url), { headers: { 'content-type': 'application/wasm' } })
}

// The baseline is the pure TypeScript implementation, kept exported for exactly this purpose.
// `parseArchiveBase64` (below, the wired one) delegates to Rust once the adapter is ready.
const { parseArchiveBase64: wiredParse, parseArchiveBase64InTypeScript: tsParse } = await import(
  new URL('src/services/chat/history/zipReader.ts', repo).href
)

// Rust side: the ported crate, browser artifact (base64 in, JSON text out).
const glue = await import(`file:///${join(process.env.TEMP, 'webzip', 'zipreader_rs.js').replace(/\\/g, '/')}`)
await glue.default({
  module_or_path: new URL(`file:///${join(process.env.TEMP, 'webzip', 'zipreader_rs_bg.wasm').replace(/\\/g, '/')}`),
})

const tsOnce = async () => JSON.stringify(await tsParse(base64))
const rustOnce = async () => JSON.stringify(JSON.parse(await glue.parseArchiveBase64(base64)))
const wiredOnce = async () => JSON.stringify(await wiredParse(base64))

const tsResult = await tsOnce()
const rustResult = await rustOnce()
console.log(`archive: ${bytes.length.toLocaleString()} bytes, base64 ${base64.length.toLocaleString()} chars`)
if (tsResult !== rustResult) {
  console.log('MISMATCH — refusing to compare timings')
  console.log('  ts  :', tsResult.slice(0, 200))
  console.log('  rust:', rustResult.slice(0, 200))
  process.exit(1)
}
const parsed = JSON.parse(tsResult)
console.log(`entries parsed: ${parsed.entries?.length ?? '?'}, identical output: yes`)

const time = async (label, iterations, run) => {
  await run() // warm up
  const start = performance.now()
  for (let index = 0; index < iterations; index += 1) await run()
  const perOp = (performance.now() - start) / iterations
  console.log(`  ${label.padEnd(22)} ${perOp.toFixed(2)} ms/op`)
  return perOp
}

const iterations = 5
const ts = await time('typescript', iterations, tsOnce)
const rust = await time('rust (base64 in)', iterations, rustOnce)
console.log(`  -> rust ${(ts / rust).toFixed(2)}x the TS time (${rust < ts ? 'WINS' : 'still slower'})`)

// The app path: `parseArchiveBase64` in zipReader.ts now delegates to the adapter, so once the
// adapter has initialised this same export should take the Rust route and land near `rust`, not
// near `ts`. Waiting for readiness first is what makes the number meaningful.
const { rustZipReader } = await import(new URL('src/rust-core/zipReader.ts', repo).href)
const deadline = Date.now() + 20000
while ((await rustZipReader.parseArchiveBase64(base64)) === undefined) {
  if (Date.now() > deadline) {
    console.log('  adapter never became ready — the app path is still TypeScript')
    process.exit(1)
  }
  await new Promise((resolve) => setTimeout(resolve, 25))
}
const wired = await time('app path (wired)', iterations, wiredOnce)
console.log(`  -> wired path is ${(ts / wired).toFixed(2)}x faster than the TS original`)
