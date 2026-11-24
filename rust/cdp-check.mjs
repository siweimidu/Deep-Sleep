// Runs an expression inside the app's real Android WebView over CDP.
//
// The emulator's WebView is Chromium 113 on the same origin the app actually uses
// (https://appassets.androidplatform.net), so this is the closest thing to device verification
// without a physical phone: it proves the shipped bundle boots *and* that the Rust wasm loads,
// compiles and (once the adapters expose it) initialises successfully.
//
// usage: node rust/cdp-check.mjs [port]
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

const result = await evaluate(`(async () => {
  const out = {
    title: document.title,
    origin: location.origin,
    url: location.href,
    webAssembly: typeof WebAssembly,
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 120),
    wasm: [],
  }
  for (const name of ['zipreader_rs_bg.e4a4cf99.wasm', 'budget_rs_bg.0a5bd0f0.wasm']) {
    try {
      const response = await fetch('/static/media/' + name)
      const bytes = await response.arrayBuffer()
      out.wasm.push({
        name,
        status: response.status,
        mime: response.headers.get('content-type'),
        bytes: bytes.byteLength,
        valid: WebAssembly.validate(bytes),
      })
    } catch (error) {
      out.wasm.push({ name, error: String(error) })
    }
  }
  out.rustReadiness = globalThis.__deepseekRust ?? null
  return out
})()`)

console.log(JSON.stringify(result, null, 2))
socket.close()
