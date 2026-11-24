// Shared harness for per-crate performance comparisons: original TypeScript vs the Rust port over
// the browser (`--target web`) glue.
//
// Rules that make the numbers comparable across crates:
//   - the Rust call goes through the SAME path the app would use (JSON text for serde_json Values,
//     `await` for async exports, JSON.parse for Value results) — see docs/rust-migration/ADOPTION.md §4;
//   - both sides must return deep-equal values first, otherwise the timing is refused;
//   - one warm-up pass, then a fixed iteration count, reported as ms/op;
//   - "verdict" is RUST only when Rust is at least 5% faster, so noise never flips a decision.
//
// usage from a per-crate bench file:
//   node --import ./rust/register-ts.mjs rust/bench/<crate>.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

export const repo = new URL('../../', import.meta.url)

/** The web glue inits by fetching the .wasm URL; Node has no file:// fetch. Call before importing. */
export const installFileFetch = () => {
  const real = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input))
    if (url.protocol !== 'file:') return real(input, init)
    return new Response(readFileSync(url), { headers: { 'content-type': 'application/wasm' } })
  }
}

/** Load the browser artifact built by `rust/build-web-core.ps1 -Crate <crate> -OutDir <dir>`. */
export const initGlue = async (crate, outDir = join(process.env.TEMP, 'bench', crate)) => {
  const snake = crate.replace(/-/g, '_')
  const at = (file) => `file:///${join(outDir, file).replace(/\\/g, '/')}`
  const glue = await import(at(`${snake}.js`))
  await glue.default({ module_or_path: new URL(at(`${snake}_bg.wasm`)) })
  return glue
}

/** Load the app's own TypeScript module (requires rust/register-ts.mjs). */
export const loadTs = async (relativePath) => import(new URL(relativePath, repo).href)

/**
 * Wire markers back to the JS values they stand for. The app adapter must do exactly this
 * (ADOPTION.md §4), and so must any comparison: without it an `undefined` object key, which JSON
 * drops, looks like a behavioural difference.
 */
export const revive = (value) => {
  if (Array.isArray(value)) return value.map(revive)
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 1 && keys[0] === '$undefined') return undefined
    if (keys.length === 1 && keys[0] === '$num') return Number(value.$num)
    if (keys.length === 1 && keys[0] === '$map') return new Map(value.$map.map(([k, v]) => [revive(k), revive(v)]))
    if (keys.length === 1 && keys[0] === '$set') return new Set(value.$set.map(revive))
    if (keys.length === 1 && keys[0] === '$bytes') return Uint8Array.from(value.$bytes)
    return Object.fromEntries(keys.map((key) => [key, revive(value[key])]))
  }
  return value
}

/** Decode a `serde_json::Value` result coming from the web glue and restore its markers. */
export const fromWire = (jsonText) => revive(JSON.parse(jsonText))

/**
 * Drop `undefined`-valued object keys. JSON cannot carry them, so crossing the wire turns
 * `{ a: undefined }` into `{}`. Every read of `obj.a` still yields `undefined`, which is the
 * semantics that matters, so the comparison treats the two forms as equal instead of failing on a
 * representational artifact of the wire.
 */
const stripUndefined = (value) => {
  if (Array.isArray(value)) return value.map(stripUndefined)
  if (value && typeof value === 'object' && !(value instanceof Map) && !(value instanceof Set)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)]),
    )
  }
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [stripUndefined(k), stripUndefined(v)]))
  if (value instanceof Set) return new Set([...value].map(stripUndefined))
  return value
}

/**
 * Compare and time one case.
 * `ts` and `rust` are zero-arg async functions returning comparable JS values.
 */
export const compare = async ({ crate, fn, iterations = 2000, ts, rust }) => {
  const expected = stripUndefined(await ts())
  const actual = stripUndefined(await rust())
  if (!isDeepStrictEqual(expected, actual)) {
    console.log(`BENCH ${crate}.${fn} MISMATCH`)
    return { crate, fn, mismatch: true }
  }
  const run = async (call) => {
    for (let index = 0; index < Math.min(iterations, 50); index += 1) await call()
    const start = performance.now()
    for (let index = 0; index < iterations; index += 1) await call()
    return (performance.now() - start) / iterations
  }
  const tsMs = await run(ts)
  const rustMs = await run(rust)
  const ratio = tsMs / rustMs
  // 5% hysteresis: below that it is noise, and keeping TypeScript is free.
  const verdict = ratio > 1.05 ? 'RUST' : 'TS'
  console.log(
    `BENCH ${crate}.${fn} ts=${tsMs.toFixed(4)} rust=${rustMs.toFixed(4)} ratio=${ratio.toFixed(2)} verdict=${verdict}`,
  )
  return { crate, fn, tsMs, rustMs, ratio, verdict }
}

/** Print a summary line so a whole crate's cases collapse into one decision. */
export const summarize = (crate, results) => {
  const useful = results.filter((result) => !result.mismatch)
  if (useful.length !== results.length) {
    console.log(`SUMMARY ${crate} MISMATCH — not eligible for wiring`)
    return
  }
  const slowest = useful.reduce((worst, item) => (item.ratio < worst.ratio ? item : worst), useful[0])
  const verdict = useful.every((item) => item.verdict === 'RUST') ? 'RUST' : 'TS'
  console.log(
    `SUMMARY ${crate} cases=${useful.length} worst=${slowest.fn} worstRatio=${slowest.ratio.toFixed(2)} verdict=${verdict}`,
  )
}
