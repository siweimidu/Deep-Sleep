// Builds a realistic, incompressible test archive with forward-slash entry names.
//
// `Compress-Archive` writes backslash paths on Windows, which the reader correctly rejects, so the
// fixture is written here instead: STORE entries, CRC32 from zlib, proper local headers + central
// directory + EOCD. Deterministic, and reproducible without PowerShell.
//
// usage: node rust/make-fixture-zip.mjs [sessions] [messagesPerSession]
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'

const sessions = Number(process.argv[2] ?? 40)
const perSession = Number(process.argv[3] ?? 200)
const target = join(process.env.TEMP, 'arch.zip')

const entitle = (buffer) => buffer.toString('latin1')
const entries = [{ name: 'manifest.json', data: Buffer.from('{"export_format_version":3}') }]
for (let session = 0; session < sessions; session += 1) {
  const messages = []
  for (let message = 0; message < perSession; message += 1) {
    messages.push(`{"id":"m${message}","role":"user","content":"${randomBytes(72).toString('base64')}"}`)
  }
  const id = `s${String(session).padStart(3, '0')}`
  entries.push({
    name: `chat_sessions/${id}.json`,
    data: Buffer.from(`{"id":"${id}","messages":[${messages.join(',')}]}`),
  })
}

const locals = []
const central = []
let offset = 0
for (const entry of entries) {
  const name = Buffer.from(entry.name, 'utf8')
  const crc = crc32(entry.data)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4) // version needed
  local.writeUInt16LE(0, 6) // flags
  local.writeUInt16LE(0, 8) // method: STORE
  local.writeUInt16LE(0, 10) // time
  local.writeUInt16LE(0x21, 12) // date
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(entry.data.length, 18)
  local.writeUInt32LE(entry.data.length, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)
  locals.push(local, name, entry.data)

  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(20, 4) // made by
  header.writeUInt16LE(20, 6) // version needed
  header.writeUInt16LE(0, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(0, 12)
  header.writeUInt16LE(0x21, 14)
  header.writeUInt32LE(crc, 16)
  header.writeUInt32LE(entry.data.length, 20)
  header.writeUInt32LE(entry.data.length, 24)
  header.writeUInt16LE(name.length, 28)
  header.writeUInt16LE(0, 30) // extra
  header.writeUInt16LE(0, 32) // comment
  header.writeUInt16LE(0, 34) // disk
  header.writeUInt16LE(0, 36) // internal attrs
  header.writeUInt32LE(0, 38) // external attrs
  header.writeUInt32LE(offset, 42)
  central.push(header, name)

  offset += local.length + name.length + entry.data.length
}

const body = Buffer.concat(locals)
const directory = Buffer.concat(central)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(entries.length, 8)
end.writeUInt16LE(entries.length, 10)
end.writeUInt32LE(directory.length, 12)
end.writeUInt32LE(body.length, 16)

const archive = Buffer.concat([body, directory, end])
writeFileSync(target, archive)
console.log(`wrote ${target}: ${archive.length.toLocaleString()} bytes, ${entries.length} entries (STORE)`)
console.log(`first entries: ${entries.slice(0, 3).map((entry) => entry.name).join(', ')}`)
