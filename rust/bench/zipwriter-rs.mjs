// Is `src/services/chat/history/zipWriter.ts` worth moving to Rust? Only its validation half is on
// the bridge: `rust/zipwriter-rs/src/port.rs::prepare` is the conformance pass `writeArchive` runs
// before it opens the STORE stream, and every non-empty archive fails there by design (a `Blob`
// cannot deliver `stream()` across the wire). So the timed unit is exactly that pass, and what both
// sides are compared on is the outcome they produce — the thrown message, or the empty archive.
//
//   powershell -NoProfile -ExecutionPolicy Bypass -File rust\build-web-core.ps1 -Crate zipwriter-rs -OutDir "$env:TEMP\bench\zipwriter-rs"
//   node --import ./rust/register-ts.mjs rust\bench\zipwriter-rs.mjs
import { compare, fromWire, initGlue, installFileFetch, loadTs, summarize } from './lib.mjs'

installFileFetch()
const glue = await initGlue('zipwriter-rs')
const { writeArchive } = await loadTs('src/services/chat/history/zipWriter.ts')

// A `Blob` cannot cross the wire: the port returns `{}` for the one archive the wire can observe and
// that is also how the recording wire encodes a Blob, so the TS side is read the same way here.
// Only the thrown message is compared, not the error class — the port throws a plain `Error` where
// the source throws `ArchiveLimitError` (checked separately below).
const outcome = async (call) => {
  try {
    const value = await call()
    return value instanceof Blob ? {} : value
  } catch (error) {
    return `throw: ${error.message}`
  }
}

// Ids look like the app's: a hex session id, then one metadata json per attachment.
const sessionId = (index) => {
  const head = ((index + 1) * 2654435761 % 0x1000000).toString(16).padStart(6, '0')
  return `${head}-6f1c-4a2e-9b3d-${(index % 100000).toString().padStart(5, '0')}`
}

const archive = (count) => {
  const entries = [
    { name: 'manifest.json', blob: { size: 412 } },
    { name: 'settings.json', blob: { size: 1873 } },
  ]
  const sessions = Math.max(0, Math.floor(count * 0.4))
  for (let index = 0; index < sessions; index += 1) {
    entries.push({ name: `chat_sessions/${sessionId(index)}.json`, blob: { size: 8000 + index * 37 } })
  }
  while (entries.length < count) {
    const index = entries.length
    // Every tenth attachment carries a CJK name, so the UTF-8 byte length the headers need is real.
    const file = index % 10 === 0 ? `会议纪要-${index}` : `f_${index}`
    entries.push({ name: `chat_sessions/${sessionId(index)}_files/${file}.json`, blob: { size: 300 + index * 7 } })
  }
  return entries.slice(0, count)
}

const cases = [
  { label: 'empty', entries: [], iterations: 20000 },
  { label: '4', entries: archive(4), iterations: 20000 },
  { label: '200', entries: archive(200), iterations: 5000 },
  { label: '2000', entries: archive(2000), iterations: 2000 },
]

const results = []
for (const { label, entries, iterations } of cases) {
  results.push(
    await compare({
      crate: 'zipwriter',
      fn: `writeArchive[${label}]`,
      iterations,
      ts: async () => outcome(() => writeArchive(entries)),
      rust: async () => outcome(async () => fromWire(await glue.writeArchive(JSON.stringify(entries)))),
    }),
  )
}

// The port documents that it throws the same message but not the same class: worth one assertion so
// the report can state it as measured rather than assumed.
const nameOf = async (call) => {
  try {
    await call()
    return 'no throw'
  } catch (error) {
    return error.name
  }
}
const overflow = [{ name: 'a', blob: { size: 4294967295 } }]
console.log(
  `NOTE zipwriter.ArchiveLimitError ts=${await nameOf(() => writeArchive(overflow))} rust=${await nameOf(() => glue.writeArchive(JSON.stringify(overflow)))}`,
)

summarize('zipwriter', results)
