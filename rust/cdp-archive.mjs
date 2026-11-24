// Device-side A/B of the two archive-parsing paths, run inside the app's real Android WebView.
//
// The import UI sits behind API-key validation, so this drives the same functions directly over
// CDP instead: `window.__deepseekLoadArchive()` loads the lazily-split chunk, which registers
// `window.__deepseekArchive` with the Rust path and the preserved TypeScript path. Both are given
// the identical 1.1 MB archive, their outputs are compared, then each is timed on the device.
//
// usage: node rust/cdp-archive.mjs [port] [archivePath]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.argv[2] ?? 9222)
const archivePath = process.argv[3] ?? join(process.env.TEMP, 'arch.zip')
const base64 = readFileSync(archivePath).toString('base64')

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((target) => target.type === 'page')
if (!page) throw new Error('no page target on the CDP port; is the app running?')

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const evaluate = (expression) =>
  new Promise((resolve, reject) => {
    const id = (nextId += 1)
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      socket.removeEventListener('message', onMessage)
      const result = message.result?.result
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else if (result?.subtype === 'error') reject(new Error(result.description))
      else resolve(result?.value)
    }
    socket.addEventListener('message', onMessage)
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })

// Push the archive in slices: one multi-megabyte CDP expression is fragile.
await evaluate('window.__archB64 = ""')
const slice = 256 * 1024
for (let offset = 0; offset < base64.length; offset += slice) {
  await evaluate(`window.__archB64 += ${JSON.stringify(base64.slice(offset, offset + slice))}`)
}
console.log(`pushed ${base64.length.toLocaleString()} base64 chars into the page`)

const loaded = await evaluate(`(async () => {
  if (typeof window.__deepseekLoadArchive !== 'function') return 'no loader'
  await window.__deepseekLoadArchive()
  return typeof window.__deepseekArchive
})()`)
console.log(`archive hook: ${loaded}`)
if (loaded !== 'object') throw new Error(`archive hook not registered (${loaded})`)

// The adapter starts its wasm init asynchronously when the chunk loads, so the first call can land
// before it is ready and quietly return undefined. Wait for the readiness flag.
const ready = await evaluate(`(async () => {
  const deadline = Date.now() + 20000
  while (!(window.__deepseekRust && window.__deepseekRust.zipReader === true)) {
    if (Date.now() > deadline) return 'timeout: ' + JSON.stringify(window.__deepseekRust ?? null)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return 'ready'
})()`)
console.log(`zipReader adapter: ${ready}`)
if (ready !== 'ready') throw new Error(`adapter never became ready (${ready})`)

const result = await evaluate(`(async () => {
  const { viaRust, inTypeScript } = window.__deepseekArchive
  const b64 = window.__archB64
  const rustOut = await viaRust(b64)
  const tsOut = await inTypeScript(b64)
  const equal = JSON.stringify(rustOut) === JSON.stringify(tsOut)
  const time = async (fn, runs) => {
    await fn(b64)
    const start = performance.now()
    for (let i = 0; i < runs; i += 1) await fn(b64)
    return (performance.now() - start) / runs
  }
  const runs = 3
  const rustMs = await time(viaRust, runs)
  const tsMs = await time(inTypeScript, runs)
  return {
    equal,
    entries: rustOut?.entries?.length ?? null,
    offset: rustOut?.offset ?? null,
    rustMs: Number(rustMs.toFixed(2)),
    tsMs: Number(tsMs.toFixed(2)),
    ratio: Number((tsMs / rustMs).toFixed(2)),
    rustFailed: rustOut === undefined,
  }
})()`)

console.log(JSON.stringify(result, null, 2))
socket.close()
process.exit(result.equal && !result.rustFailed ? 0 : 1)
