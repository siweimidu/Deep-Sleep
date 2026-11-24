// End-to-end check of the app's adapters (`src/rust-core/*.ts`), not just the raw wasm glue.
//
// web-parity.mjs proves each crate's functions match the original; it does not exercise the modules
// the app actually imports (the JSON.parse step for Value returns, the ready gate, the fallback).
// This runs those modules for real: a fetch shim serves each wasm from disk so the browser-target
// init() succeeds, then the asserted values are the ones the original TS produces.
//
// usage: node rust/adapter-check.mjs
import { readFileSync } from 'node:fs'

const repo = new URL('../', import.meta.url)

// The web-target glue inits by fetching the module URL; Node has no file:// fetch.
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(String(input))
  if (url.protocol !== 'file:') return realFetch(input, init)
  return new Response(readFileSync(url), { headers: { 'content-type': 'application/wasm' } })
}

const { rustPaths } = await import(new URL('src/rust-core/paths.ts', repo).href)
const { rustAttachments } = await import(new URL('src/rust-core/attachments.ts', repo).href)
const { rustLocation } = await import(new URL('src/rust-core/location.ts', repo).href)

// Both adapters load in the background; wait until each reports ready.
const ready = () =>
  rustPaths.parseSessionPath('probe') !== undefined &&
  rustAttachments.getFileExt('probe') !== undefined &&
  rustLocation.getRegionName('probe', 'zh-CN') !== undefined
const deadline = Date.now() + 20000
while (!ready()) {
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

  ['getFileExt lowercases', rustAttachments.getFileExt('A.PNG'), 'png'],
  ['getFileExt dotless', rustAttachments.getFileExt('README'), ''],
  ['getFileExt leading dot', rustAttachments.getFileExt('.gitignore'), ''],
  ['getExtension uppercases', rustAttachments.getExtension('a.tar.gz'), 'GZ'],
  ['isAcceptedExt yes', rustAttachments.isAcceptedExt('a.png'), true],
  ['isAcceptedExt no', rustAttachments.isAcceptedExt('a.exe'), false],
  ['getUploadPurpose layout', rustAttachments.getUploadPurpose('a.pdf', false), 'rich_layout_recognition'],
  ['getUploadPurpose data', rustAttachments.getUploadPurpose('a.txt', false), 'user_data'],
  // `null` is the real answer for an image here, which is why "not ready" is `undefined` instead.
  ['getUploadPurpose image', rustAttachments.getUploadPurpose('a.png', true), null],
  ['isImage yes', rustAttachments.isImage('image/png'), true],
  ['isImage no', rustAttachments.isImage('text/plain'), false],
  ['formatSize bytes', rustAttachments.formatSize(0), '0 B'],
  ['formatSize KB', rustAttachments.formatSize(1024), '1.0 KB'],
  ['formatSize KB frac', rustAttachments.formatSize(1536), '1.5 KB'],
  ['formatSize MB', rustAttachments.formatSize(1048576), '1.0 MB'],

  ['getRegionName unknown', rustLocation.getRegionName('ZZ', 'zh-CN'), ''],
  ['getRegionName Intl', rustLocation.getRegionName('JP', 'en-US'), 'Japan'],
  ['normalizeLocation non-CN', rustLocation.normalizeLocation({ region: 'JP' }), { region: 'JP' }],
  ['normalizeLocation null', rustLocation.normalizeLocation(null), null],
  ['normalizeLocation string', rustLocation.normalizeLocation('x'), null],
  // A city without a province is rejected by the original.
  ['normalizeLocation city alone', rustLocation.normalizeLocation({ region: 'CN', city: '1101' }), null],
]

// Primitives and `null` by identity; plain objects by their JSON shape.
const same = (got, want) =>
  Object.is(got, want) ||
  (typeof got === 'object' && typeof want === 'object' && JSON.stringify(got) === JSON.stringify(want))

let failed = 0
for (const [name, got, want] of cases) {
  const ok = same(got, want)
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(got)}`)
}
console.log(failed === 0 ? `adapter: ${cases.length}/${cases.length} through the app adapters` : `adapter: ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
