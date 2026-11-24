// Serves `dist/` over HTTP so the built bundle can be opened in a real Chromium engine.
//
// The Android WebView is Chromium, so this is the cheapest way to find out whether the shipped
// bundle boots and whether the Rust wasm actually compiles in that engine - before spending time on
// an emulator or a physical device.
//
// usage: node rust/serve-dist.mjs [port]
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const port = Number(process.argv[2] ?? 8731)
// `fileURLToPath` handles the Windows drive letter and percent-encoding; URL `.pathname` keeps
// `%E9%87%8D…` for this repo's non-ASCII directory and every request 404s.
const root = fileURLToPath(new URL('../dist/', import.meta.url))

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

createServer((request, response) => {
  const requested = decodeURIComponent((request.url ?? '/').split('?')[0])
  const relative = normalize(requested === '/' ? '/index.html' : requested).replace(/^([/\\])+/, '')
  const file = join(root, relative)
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end('not found')
    return
  }
  response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(response)
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} on http://127.0.0.1:${port}`)
})
