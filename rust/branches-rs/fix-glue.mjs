// `rust-anything refresh` regenerates `index.cjs`: the JSON path revives the wire markers
// (`$map`, `$undefined`, `$num`) but the binary wire path does not, so the `Map` that
// `buildMessageVersions` returns arrives as a plain object.
//
// `build` keeps this fix; `refresh` drops it. Re-run after any refresh:
//   node rust/branches-rs/fix-glue.mjs
// Idempotent.
import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('./index.cjs', import.meta.url)
const anchor = '\nreturn t\n}\nmodule.exports.buildMessageVersions'
const patched = '\nreturn revive(t)\n}\nmodule.exports.buildMessageVersions'
const source = readFileSync(file, 'utf8')

if (source.includes(patched)) {
  console.log('already patched: index.cjs')
  process.exit(0)
}
if (!source.includes(anchor)) {
  console.error('anchor not found; inspect index.cjs by hand before trusting `buildMessageVersions`')
  process.exit(1)
}
writeFileSync(file, source.replace(anchor, patched))
console.log('patched: index.cjs now revives the binary wire result')
