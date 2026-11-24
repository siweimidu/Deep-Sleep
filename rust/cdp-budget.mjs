// Device-side A/B of the token estimator, run inside the app's real Android WebView.
//
// `budget.estimateTokens` was the other unit that measured faster in Rust (1.2-1.8x, but only above
// ~128 UTF-16 units), so it must be confirmed on the device too - the CSP lesson was that a Node
// number buys nothing if the WebView never runs the code.
//
// The TypeScript reference is the original 10-line loop, inlined here so nothing extra has to ship.
//
// usage: node rust/cdp-budget.mjs [port]
const port = Number(process.argv[2] ?? 9222)

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
    socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    )
  })

const ready = await evaluate(`(async () => {
  const deadline = Date.now() + 20000
  while (!(window.__deepseekRust && window.__deepseekRust.budget === true)) {
    if (Date.now() > deadline) return 'timeout: ' + JSON.stringify(window.__deepseekRust ?? null)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return typeof window.__deepseekRust.estimateTokensRust === 'function' ? 'ready' : 'no function'
})()`)
console.log(`budget adapter: ${ready}`)
if (ready !== 'ready') throw new Error(`adapter not ready (${ready})`)

const result = await evaluate(`(() => {
  const rust = window.__deepseekRust.estimateTokensRust
  // The original implementation, verbatim.
  const reference = (text) => {
    if (!text) { return 0 }
    let wide = 0
    let narrow = 0
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0
      if (code > 0x2e7f) { wide += 1 } else { narrow += 1 }
    }
    return Math.ceil(wide + narrow / 3.6)
  }
  const prosa = 'the quick brown fox jumps over the lazy dog and keeps on running '.repeat(400)
  const cjk = '重构是把一段代码换成另一种语言然后证明行为一致'.repeat(60)
  const sizes = [16, 64, 128, 256, 512, 1024, 4096, 100 * 1024]
  const out = []
  for (const size of sizes) {
    const text = (prosa + cjk).slice(0, size)
    const runs = size > 4096 ? 200 : 5000
    const expected = reference(text)
    const got = rust(text)
    const time = (fn) => {
      for (let i = 0; i < Math.min(runs, 200); i += 1) fn()
      const start = performance.now()
      for (let i = 0; i < runs; i += 1) fn()
      return (performance.now() - start) / runs
    }
    const tsMs = time(() => reference(text))
    const rustMs = time(() => rust(text))
    out.push({
      size,
      equal: got === expected,
      rustMs: Number(rustMs.toFixed(5)),
      tsMs: Number(tsMs.toFixed(5)),
      ratio: Number((tsMs / rustMs).toFixed(2)),
    })
  }
  return out
})()`)

console.log(JSON.stringify(result, null, 2))
const bad = result.filter((row) => !row.equal)
console.log(bad.length === 0 ? 'all sizes produce identical values on device' : `${bad.length} sizes disagreed`)
socket.close()
process.exit(bad.length === 0 ? 0 : 1)
