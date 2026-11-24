// Is `src/services/documentText.ts` worth moving to Rust? Only two of its exports crossed the bridge:
// `extensionOf` and `canExtractText` (`rust/documenttext-rs/src/port.rs`). `extractDocumentText`
// stays in TypeScript — it takes a `File` whose bytes never cross the JSON wire, so nothing about it
// can be timed here.
//
//   powershell -NoProfile -ExecutionPolicy Bypass -File rust\build-web-core.ps1 -Crate documenttext-rs -OutDir "$env:TEMP\bench\documenttext-rs"
//   node --import ./rust/register-ts.mjs rust\bench\documenttext-rs.mjs
import { compare, fromWire, initGlue, installFileFetch, loadTs, summarize } from './lib.mjs'

installFileFetch()
const glue = await initGlue('documenttext-rs')
const { extensionOf, canExtractText } = await loadTs('src/services/documentText.ts')

// Both glue exports return `serde_json::Value` as JSON text (ADOPTION.md §4), and both are
// synchronous on the wire, so there is no `await` to pay on this side of the boundary.
const viaRust = (name, arg) => fromWire(glue[name](arg))

// Names a user actually picks: CJK with an upper-case extension, an ASCII document, and a photo the
// extractor must reject.
const names = {
  cjk: '会议纪要-2024年12月.PDF',
  plain: 'report.docx',
  photo: 'IMG_2034.JPG',
}

const results = []
for (const [label, name] of Object.entries(names)) {
  results.push(
    await compare({
      crate: 'documenttext',
      fn: `extensionOf[${label}]`,
      iterations: 20000,
      ts: async () => extensionOf(name),
      rust: async () => viaRust('extensionOf', name),
    }),
  )
  results.push(
    await compare({
      crate: 'documenttext',
      fn: `canExtractText[${label}]`,
      iterations: 20000,
      ts: async () => canExtractText(name),
      rust: async () => viaRust('canExtractText', name),
    }),
  )
}
summarize('documenttext', results)
