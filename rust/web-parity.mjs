// Replays a crate's recorded corpus against the **browser** (`wasm-bindgen --target web`) artifact.
//
// `rust-anything diff` only ever exercises the Node-target glue (which reads the .wasm with
// `require('fs')`). What actually ships into the Android WebView is the `--target web` ESM build,
// so that has to be proven separately or the deployment path is untested.
//
// The two targets are NOT drop-in equivalent. In the web glue a `serde_json::Value` is a JSON-text
// boundary in *both* directions:
//   - the .d.ts declares `readMessageEvent(value: string): string`
//   - the Node glue hides this, it encodes args and decodes results itself
// So the adapter must JSON.stringify a Value argument and JSON.parse a Value result. This harness
// reads the authoritative param types from the crate's `rust-anything.json` (`params[].ts_type`)
// and the return conversions from the generated Node glue, then applies exactly that adapter step.
// It measures the artifact *with* the documented adapter, not a naive call.
//
// Wire markers (`{"$undefined":true}`, `{"$num":"NaN"}`, `{"$map":[..]}`) are left intact when
// encoding an argument: the port recognises them, which is how `undefined` survives a JSON string.
//
// usage: node rust/web-parity.mjs <webGlue.js> <webModule.wasm> <cases.jsonl> <nodeGlue.cjs>
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const [gluePath, wasmPath, casesPath, nodeGluePath] = process.argv.slice(2)
if (!gluePath || !wasmPath || !casesPath || !nodeGluePath) {
  console.error('usage: node rust/web-parity.mjs <webGlue.js> <webModule.wasm> <cases.jsonl> <nodeGlue.cjs>')
  process.exit(2)
}

/** Wire markers back to the JS values they stand for. */
const revive = (value) => {
  if (Array.isArray(value)) return value.map(revive)
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 1 && keys[0] === '$undefined') return undefined
    if (keys.length === 1 && keys[0] === '$num') return Number(value.$num)
    if (keys.length === 1 && keys[0] === '$map') return new Map(value.$map.map(([k, v]) => [revive(k), revive(v)]))
    if (keys.length === 1 && keys[0] === '$set') return new Set(value.$set.map(revive))
    if (keys.length === 1 && keys[0] === '$bytes') return Uint8Array.from(value.$bytes)
    return Object.fromEntries(keys.map((k) => [k, revive(value[k])]))
  }
  return value
}

/** Split on top-level commas only, so `Map<String, Value>` stays one parameter. */
const splitTop = (text) => {
  const out = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if ('<([{'.includes(char)) depth += 1
    else if ('>)]}'.includes(char)) depth -= 1
    if (char === ',' && depth === 0) {
      out.push(current)
      current = ''
    } else current += char
  }
  if (current.trim()) out.push(current)
  return out.map((part) => part.trim()).filter(Boolean)
}

// The Rust signature is the only unambiguous answer to "is this parameter a serde_json::Value?".
// A TS type like `'a' | 'b'` or `ChatModel` becomes a plain Rust `String` and must be passed raw;
// an object type becomes `serde_json::Value` and travels as JSON text.
const portSource = readFileSync(join(dirname(casesPath), 'src', 'port.rs'), 'utf8').replace(/\s+/g, ' ')
const rustParams = new Map()
for (const [, name, params] of portSource.matchAll(/pub (?:async )?fn (\w+)\s*\(([^)]*)\)/g)) {
  const types = splitTop(params)
    .filter((p) => !/^&\s*(mut\s+)?self\b|^self\b/.test(p))
    .map((p) => (p.includes(':') ? p.slice(p.indexOf(':') + 1).trim() : p))
  rustParams.set(name, types)
}
const toSnake = (name) => name.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)
// `port.rs` imports `Value` from serde_json and uses the bare name, so match the type by name
// rather than by a `serde_json::Value` path.
const isJsonParam = (key, index) => /\bValue\b/.test(rustParams.get(toSnake(key.split('.').pop()))?.[index] ?? '')

// Declared param types, keyed by export name and by `Class.method`, from the bridge manifest.
const manifest = JSON.parse(readFileSync(join(dirname(casesPath), 'rust-anything.json'), 'utf8'))
const paramTypes = new Map()
for (const entry of manifest.exports ?? []) paramTypes.set(entry.name, entry.params ?? [])
for (const klass of manifest.classes ?? []) {
  paramTypes.set(`${klass.name}.__ctor`, klass.constructor ?? [])
  for (const method of klass.methods ?? []) paramTypes.set(`${klass.name}.${method.name}`, method.params ?? [])
}

const nodeGlue = readFileSync(nodeGluePath, 'utf8')

/** Functions the Node glue marks as returning serde_json::Value ('json'). */
const jsonReturns = new Set(
  [...nodeGlue.matchAll(/^\s*(\w+): \[\[[^\]]*\], '(\w+)'(?:, (?:true|false))?\]/gm)]
    .filter(([, , convert]) => convert === 'json')
    .map(([, name]) => name),
)

/** Class name -> method name -> conversion, from the Node glue. */
const classConverts = new Map(
  [...nodeGlue.matchAll(/(\w+): \[\[[^\]]*\], \{([^}]*)\}\]/g)].map(([, name, methods]) => [
    name,
    new Map([...methods.matchAll(/(\w+): \[\[[^\]]*\], '(\w+)'/g)].map(([, m, convert]) => [m, convert])),
  ]),
)

/** Encode arguments the way the documented adapter must. */
const encodeArgs = (key, args) => {
  const declared = paramTypes.get(key) ?? []
  // A trailing optional parameter is simply absent from the recorded call. The Node glue encodes
  // that as the `$undefined` marker, so pad to the declared arity instead of passing `undefined`
  // (which the web glue then dereferences, e.g. "Cannot read properties of undefined").
  const arity = Math.max(args.length, declared.length)
  return Array.from({ length: arity }, (_, index) => {
    const arg = index < args.length ? args[index] : { $undefined: true }
    if (isJsonParam(key, index)) return JSON.stringify(arg)
    return index < args.length ? revive(arg) : undefined
  })
}

const decodeResult = (value, convert) => {
  if (convert === 'json' && typeof value === 'string') return revive(JSON.parse(value))
  return value
}

const glue = await import(pathToFileURL(gluePath).href)
await glue.default({ module_or_path: await WebAssembly.compile(readFileSync(wasmPath)) })

const cases = readFileSync(casesPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))

let pass = 0
let fail = 0
let skipped = 0
const failures = []
let lastFailIndex = -1
let firstFailIndex = -1
let currentCaseIndex = 0

const record = (ok, detail) => {
  if (ok) {
    pass += 1
    return
  }
  fail += 1
  if (firstFailIndex < 0) firstFailIndex = currentCaseIndex
  lastFailIndex = Math.max(lastFailIndex, currentCaseIndex)
  if (failures.length < 5) failures.push(detail)
}

for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
  const testCase = cases[caseIndex]
  currentCaseIndex = caseIndex
  if (testCase.class) {
    const Ctor = glue[testCase.class]
    if (typeof Ctor !== 'function') {
      skipped += 1
      continue
    }
    const converts = classConverts.get(testCase.class) ?? new Map()
    let instance
    try {
      instance = new Ctor(...encodeArgs(`${testCase.class}.__ctor`, testCase.ctor))
    } catch (error) {
      record(false, { class: testCase.class, why: 'constructor threw', got: String(error) })
      continue
    }
    for (let index = 0; index < testCase.calls.length; index += 1) {
      const call = testCase.calls[index]
      // results[0] belongs to the constructor, so call i pairs with results[i + 1].
      const expected = testCase.results[index + 1]
      const threw = Boolean(expected && 'error' in expected)
      try {
        // An `async` source export comes back as a Promise from the web glue.
        const raw = await instance[call.method](...encodeArgs(`${testCase.class}.${call.method}`, call.args))
        const got = decodeResult(raw, converts.get(call.method))
        record(!threw && isDeepStrictEqual(got, revive(expected?.ok)), {
          method: call.method,
          expected: expected?.ok,
          got,
        })
      } catch (error) {
        // Both sides throwing is agreement: the port's message is not the contract here.
        record(threw, { method: call.method, why: 'port threw', got: String(error) })
      }
    }
    continue
  }

  if (!testCase.fn || typeof glue[testCase.fn] !== 'function') {
    skipped += 1
    continue
  }
  const threw = testCase.error !== undefined
  try {
    // An `async` source export comes back as a Promise from the web glue.
    const raw = await glue[testCase.fn](...encodeArgs(testCase.fn, testCase.args))
    const got = decodeResult(raw, jsonReturns.has(testCase.fn) ? 'json' : undefined)
    record(!threw && isDeepStrictEqual(got, revive(testCase.ok)), {
      fn: testCase.fn,
      expected: testCase.ok,
      got,
    })
  } catch (error) {
    record(threw, { fn: testCase.fn, why: 'port threw', expected: testCase.ok, got: String(error) })
  }
}

console.log(`${pass}/${pass + fail} match on the --target web artifact` + (skipped ? ` (${skipped} skipped)` : ''))
if (fail) console.log(`  failures span case #${firstFailIndex}..#${lastFailIndex} of ${cases.length}`)
for (const failure of failures) {
  // Show the interesting side only; `expected` is often a whole session object.
  const at = failure.fn ?? failure.method
  const got = typeof failure.got === 'string' ? failure.got : JSON.stringify(failure.got)
  const want = JSON.stringify(failure.expected)
  console.log('  ', JSON.stringify({ at, why: failure.why ?? 'differs', got: got?.slice(0, 140), want: want?.slice(0, 140) }))
}
process.exit(fail === 0 ? 0 : 1)
