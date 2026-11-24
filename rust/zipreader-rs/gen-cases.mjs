// Builds cases-extra.jsonl for `parseArchiveBase64` (src/services/chat/history/zipReader.ts).
// Run: node gen-cases.mjs
//
// Every case is a hand-built ZIP: either an archive the reader must accept, or one with a single
// field deliberately broken so a specific rejection path is exercised. CRC32 comes from
// node:zlib, so the checksum the reader verifies is produced by an independent oracle.
import { crc32 as nodeCrc32, deflateRawSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'

const le16 = (n) => {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n >>> 0)
  return b
}
const le32 = (n) => {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0)
  return b
}
const sum = (bytes) => nodeCrc32(bytes) >>> 0
const DOS_DATE = 0x21 // 1980-01-01

// `name`/`data` are the truth; every other field can be overridden to corrupt the entry.
const build = (specs, archive = {}) => {
  const parts = []
  const centers = []
  let offset = 0
  for (const spec of specs) {
    const name = spec.nameBytes ?? Buffer.from(spec.name, 'utf8')
    const localName = spec.localNameBytes ?? name
    const data = spec.data ?? Buffer.alloc(0)
    const method = spec.method ?? 0
    const payload = spec.payload ?? (method === 0 ? data : deflateRawSync(data))
    const flags = spec.flags ?? 0
    const entryCrc = spec.crc ?? sum(data)
    const compressedSize = spec.csize ?? payload.length
    const size = spec.size ?? data.length
    const extra = spec.extra ?? Buffer.alloc(0)
    const localExtra = spec.localExtra ?? extra
    // A data descriptor moves the checksum and sizes out of the local header.
    const placeholder = (flags & 8) !== 0
    const local = Buffer.concat([
      le32(spec.localSig ?? 0x04034b50),
      le16(spec.versionNeeded ?? 20),
      le16(spec.localFlags ?? flags),
      le16(spec.localMethod ?? method),
      le16(0),
      le16(DOS_DATE),
      le32(spec.lcrc ?? (placeholder ? 0 : entryCrc)),
      le32(spec.lcsize ?? (placeholder ? 0 : compressedSize)),
      le32(spec.lsize ?? (placeholder ? 0 : size)),
      le16(spec.localNameLength ?? localName.length),
      le16(localExtra.length),
      localName,
      localExtra,
    ])
    const descriptor =
      spec.descriptorRaw ??
      (spec.descriptor
        ? Buffer.concat([
            ...(spec.descriptorSig === false ? [] : [le32(0x08074b50)]),
            le32(spec.descriptorCrc ?? entryCrc),
            le32(spec.descriptorCsize ?? compressedSize),
            le32(spec.descriptorSize ?? size),
          ])
        : Buffer.alloc(0))
    parts.push(local, payload, descriptor)
    centers.push({ spec, name, extra, offset, entryCrc, compressedSize, size, method, flags })
    offset += local.length + payload.length + descriptor.length
  }
  const directoryStart = offset
  const centrals = centers.map((center) => {
    const { spec, name, extra } = center
    return Buffer.concat([
      le32(spec.centralSig ?? 0x02014b50),
      le16(spec.versionMadeBy ?? 20),
      le16(spec.versionNeeded ?? 20),
      le16(center.flags),
      le16(center.method),
      le16(0),
      le16(DOS_DATE),
      le32(spec.centralCrc ?? center.entryCrc),
      le32(spec.centralCsize ?? center.compressedSize),
      le32(spec.centralSize ?? center.size),
      le16(spec.centralNameLength ?? name.length),
      le16(extra.length),
      le16(spec.commentLength ?? 0),
      le16(spec.diskStart ?? 0),
      le16(0),
      le32(spec.externalAttrs ?? 0),
      le32(spec.localOffset ?? center.offset),
      name,
      extra,
    ])
  })
  const ordered = archive.reverseDirectory ? centrals.slice().reverse() : centrals
  const directory = Buffer.concat(ordered)
  const comment = archive.comment ?? Buffer.alloc(0)
  const eocd = Buffer.concat([
    le32(archive.sig ?? 0x06054b50),
    le16(archive.diskNumber ?? 0),
    le16(archive.diskStart ?? 0),
    le16(archive.startCount ?? centers.length),
    le16(archive.count ?? centers.length),
    le32(archive.size ?? directory.length),
    le32(archive.offset ?? directoryStart),
    le16(comment.length),
    comment,
  ])
  return Buffer.concat([...parts, directory, eocd])
}

const cases = []
const push = (label, bytes) => {
  cases.push({ label, line: { fn: 'parseArchiveBase64', args: [bytes.toString('base64')] } })
}
const raw = (label, base64) => {
  cases.push({ label, line: { fn: 'parseArchiveBase64', args: [base64] } })
}

const MANIFEST = Buffer.from('{"export_format_version":3}', 'utf8')
const SESSION = Buffer.from('{"id":"s1","title":"hi"}', 'utf8')
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe])
const deflated = (bytes) => deflateRawSync(bytes)

// --- accepted ----------------------------------------------------------------------
push(
  'ok store: manifest + session + dir + image',
  build([
    { name: 'manifest.json', data: MANIFEST },
    { name: 'chat_sessions/s1.json', data: SESSION },
    { name: 'chat_sessions/s1_files/', data: Buffer.alloc(0) },
    { name: 'chat_sessions/s1_files/f1_a.png', data: PNG },
  ])
)
push('ok store: single entry', build([{ name: 'manifest.json', data: MANIFEST }]))
push('ok store: empty payload', build([{ name: 'a.json', data: Buffer.alloc(0) }]))
push('ok store: one zero byte', build([{ name: 'a.json', data: Buffer.from([0]) }]))
push('ok store: only a newline', build([{ name: 'a.json', data: Buffer.from('\r\n') }]))
push(
  'ok deflate: two entries',
  build([
    { name: 'manifest.json', data: MANIFEST, method: 8 },
    { name: 'chat_sessions/s1.json', data: SESSION, method: 8 },
  ])
)
push('ok deflate: empty payload', build([{ name: 'a.json', data: Buffer.alloc(0), method: 8 }]))
push(
  'ok deflate: zero compressed size',
  build([{ name: 'a.json', data: Buffer.alloc(0), method: 8, payload: Buffer.alloc(0) }])
)
push(
  'ok store: data descriptor with signature',
  build([{ name: 'manifest.json', data: MANIFEST, flags: 8, descriptor: true }])
)
push(
  'ok deflate: data descriptor without signature',
  build([{ name: 'a.json', data: MANIFEST, method: 8, flags: 8, descriptor: true, descriptorSig: false }])
)
push(
  'ok eocd: trailing comment',
  build([{ name: 'manifest.json', data: MANIFEST }], { comment: Buffer.from('exported') })
)
push('ok empty archive: no entries', build([]))
push('ok utf8 flag: non-ASCII name', build([{ name: '会话.json', data: MANIFEST, flags: 0x800 }]))
push('ok utf8 flag: NFC name', build([{ name: '\u00e9.json', data: MANIFEST, flags: 0x800 }]))
push('ok utf8 flag: NFD name normalised', build([{ name: 'e\u0301.json', data: MANIFEST, flags: 0x800 }]))
push(
  'ok names: case differs, not a duplicate',
  build([
    { name: 'a.json', data: MANIFEST },
    { name: 'A.json', data: MANIFEST },
  ])
)
push(
  'ok names: a/b and a are distinct',
  build([
    { name: 'a', data: MANIFEST },
    { name: 'a/b', data: MANIFEST },
  ])
)
push('ok name: two-letter prefix is not a drive', build([{ name: 'AB:/x', data: MANIFEST }]))
push('ok name: leading BOM is kept', build([{ name: '\ufeffa.json', data: MANIFEST, flags: 0x800 }]))
push(
  'ok extra: known field id 2',
  build([{ name: 'a.json', data: MANIFEST, extra: Buffer.concat([le16(2), le16(4), le32(0)]) }])
)
push(
  'ok entry offsets ascend while names do not',
  build([
    { name: 'b.json', data: SESSION },
    { name: 'a.json', data: MANIFEST },
  ])
)
push(
  'ok central directory listed in reverse physical order',
  build(
    [
      { name: 'a.json', data: MANIFEST },
      { name: 'b.json', data: SESSION },
    ],
    { reverseDirectory: true }
  )
)

// --- rejected: the base64 gate -----------------------------------------------------
raw('bad base64: empty string', '')
raw('bad base64: not base64', 'hello!')
raw('bad base64: missing padding', 'YQ')
raw('bad base64: inner whitespace', 'YW Jj')
raw('bad base64: one character', 'a')
raw('bad base64: over-padded', 'YQ===')
raw('bad base64: newline', 'YQ==\n')
raw('bad base64: url-safe alphabet', 'YQ--')
raw('bytes: 21 zero bytes', Buffer.alloc(21, 0x50).toString('base64'))
raw('bytes: 3 garbage bytes', 'AAAA')
raw('bytes: 4096 garbage bytes', Buffer.alloc(4096, 0x41).toString('base64'))

// --- rejected: signatures, truncation, trailing bytes ------------------------------
push('bad eocd signature', build([{ name: 'a.json', data: MANIFEST }], { sig: 0x06054b51 }))
push('bad central signature', build([{ name: 'a.json', data: MANIFEST, centralSig: 0x02014b51 }]))
push('bad local signature', build([{ name: 'a.json', data: MANIFEST, localSig: 0x04034b51 }]))
push(
  'truncated: last byte of eocd removed',
  build([{ name: 'a.json', data: MANIFEST }]).subarray(0, -1)
)
push(
  'truncated: inside the central directory',
  build([
    { name: 'a.json', data: MANIFEST },
    { name: 'b.json', data: SESSION },
  ]).subarray(0, 60)
)
push('truncated: inside the local header', build([{ name: 'a.json', data: MANIFEST }]).subarray(0, 12))
push('appended: two zero bytes after eocd', Buffer.concat([build([{ name: 'a.json', data: MANIFEST }]), Buffer.alloc(2)]))
push('appended: eocd shaped junk', Buffer.concat([build([{ name: 'a.json', data: MANIFEST }]), le32(0x06054b50)]))

// --- rejected: end of central directory rules --------------------------------------
push('eocd: count larger than the directory', build([{ name: 'a.json', data: MANIFEST }], { count: 2 }))
push(
  'eocd: this-disk count differs from the total',
  build(
    [
      { name: 'a.json', data: MANIFEST },
      { name: 'b.json', data: MANIFEST },
    ],
    { startCount: 1 }
  )
)
push('eocd: nonzero disk number', build([{ name: 'a.json', data: MANIFEST }], { diskNumber: 1 }))
push('eocd: nonzero disk start', build([{ name: 'a.json', data: MANIFEST }], { diskStart: 1 }))
push('eocd: zip64 count marker', build([{ name: 'a.json', data: MANIFEST }], { count: 0xffff }))
push('eocd: zip64 size marker', build([{ name: 'a.json', data: MANIFEST }], { size: 0xffffffff }))
push('eocd: zip64 offset marker', build([{ name: 'a.json', data: MANIFEST }], { offset: 0xffffffff }))
push('eocd: offset off by one', build([{ name: 'a.json', data: MANIFEST }], { offset: 1 }))
push('eocd: size off by one', build([{ name: 'a.json', data: MANIFEST }], { size: 1 }))

// --- rejected: central directory entry rules ---------------------------------------
push('central: zip64 compressed size', build([{ name: 'a.json', data: MANIFEST, centralCsize: 0xffffffff }]))
push('central: zip64 size', build([{ name: 'a.json', data: MANIFEST, centralSize: 0xffffffff }]))
push('central: zip64 local offset', build([{ name: 'a.json', data: MANIFEST, localOffset: 0xffffffff }]))
push('central: encrypted flag', build([{ name: 'a.json', data: MANIFEST, flags: 1 }]))
push('central: strong encryption flag', build([{ name: 'a.json', data: MANIFEST, flags: 0x41 }]))
push('central: unknown method 12', build([{ name: 'a.json', data: MANIFEST, method: 12 }]))
push('central: store with compressed size != size', build([{ name: 'a.json', data: MANIFEST, centralCsize: 3 }]))
push('central: local offset past the directory', build([{ name: 'a.json', data: MANIFEST, localOffset: 0x7fff }]))
push('central: disk start not zero', build([{ name: 'a.json', data: MANIFEST, diskStart: 1 }]))
push('central: symlink external attrs', build([{ name: 'a.json', data: MANIFEST, externalAttrs: 0xa1ff0000 }]))
push('central: comment length past the directory', build([{ name: 'a.json', data: MANIFEST, commentLength: 0xffff }]))
push('central: name length past the directory', build([{ name: 'a.json', data: MANIFEST, centralNameLength: 0xffff }]))
push(
  'central: extra field id 1 is zip64',
  build([{ name: 'a.json', data: MANIFEST, extra: Buffer.concat([le16(1), le16(0)]) }])
)
push(
  'central: extra field runs past its own end',
  build([{ name: 'a.json', data: MANIFEST, extra: Buffer.concat([le16(2), le16(9)]) }])
)
push(
  'central: extra field header cut mid-way',
  build([{ name: 'a.json', data: MANIFEST, extra: Buffer.from([2, 0]) }])
)
push(
  'central: extra field trailing padding',
  build([{ name: 'a.json', data: MANIFEST, extra: Buffer.concat([le16(2), le16(4), le32(0), Buffer.alloc(2)]) }])
)

// --- rejected: names ---------------------------------------------------------------
push('name: parent segment', build([{ name: 'a/../b.json', data: MANIFEST }]))
push('name: dot segment', build([{ name: './a.json', data: MANIFEST }]))
push('name: empty segment', build([{ name: 'a//b.json', data: MANIFEST }]))
push('name: absolute', build([{ name: '/etc/passwd', data: MANIFEST }]))
push('name: drive letter', build([{ name: 'C:/a.json', data: MANIFEST }]))
push('name: colon after one letter', build([{ name: 'a:b.json', data: MANIFEST }]))
push('name: backslash', build([{ name: 'a\\b.json', data: MANIFEST }]))
push('name: NUL byte', build([{ name: 'a\u0000b.json', data: MANIFEST }]))
push('name: empty', build([{ name: '', data: MANIFEST }]))
push('name: only a slash', build([{ name: '/', data: Buffer.alloc(0) }]))
push('name: dot only', build([{ name: '.', data: MANIFEST }]))
push('name: two dots only', build([{ name: '..', data: MANIFEST }]))
push('name: directory segment named dot', build([{ name: 'a/./b', data: MANIFEST }]))
push(
  'name: duplicate file',
  build([
    { name: 'a.json', data: MANIFEST },
    { name: 'a.json', data: MANIFEST },
  ])
)
push(
  'name: NFC and NFD collide',
  build([
    { name: '\u00e9.json', data: MANIFEST, flags: 0x800 },
    { name: 'e\u0301.json', data: MANIFEST, flags: 0x800 },
  ])
)
push(
  'name: directory and file collide',
  build([
    { name: 'a', data: MANIFEST },
    { name: 'a/', data: Buffer.alloc(0) },
  ])
)
push('name: directory with a payload', build([{ name: 'a/', data: MANIFEST }]))
push(
  'name: high byte without the utf8 flag',
  build([{ name: 'a.json', nameBytes: Buffer.from([0x61, 0x2e, 0xe9]) }])
)
push(
  'name: invalid utf8 with the utf8 flag',
  build([{ name: 'a.json', nameBytes: Buffer.from([0x61, 0xff, 0xfe]), flags: 0x800 }])
)

// --- rejected: local header rules --------------------------------------------------
push('local: flags differ', build([{ name: 'a.json', data: MANIFEST, localFlags: 8 }]))
push('local: method differs', build([{ name: 'a.json', data: MANIFEST, localMethod: 8 }]))
push('local: name length differs', build([{ name: 'a.json', data: MANIFEST, localNameLength: 5 }]))
push('local: crc differs', build([{ name: 'a.json', data: MANIFEST, lcrc: 1 }]))
push('local: compressed size differs', build([{ name: 'a.json', data: MANIFEST, lcsize: 3 }]))
push('local: size differs', build([{ name: 'a.json', data: MANIFEST, lsize: 3 }]))
push(
  'local: name bytes differ at equal length',
  build([{ name: 'a.json', data: MANIFEST, localNameBytes: Buffer.from('b.json') }])
)
push(
  'local: descriptor crc differs',
  build([{ name: 'a.json', data: MANIFEST, flags: 8, descriptor: true, descriptorCrc: 1 }])
)
push(
  'local: descriptor size differs',
  build([{ name: 'a.json', data: MANIFEST, flags: 8, descriptor: true, descriptorSize: 3 }])
)
push(
  'local: descriptor truncated to 4 bytes',
  build([{ name: 'a.json', data: MANIFEST, flags: 8, descriptorRaw: Buffer.from([1, 2, 3, 4]) }])
)
push(
  'local: two entries share one local header',
  build([
    { name: 'a.json', data: MANIFEST },
    { name: 'b.json', data: MANIFEST, localOffset: 0 },
  ])
)

// --- rejected: payload -------------------------------------------------------------
push('payload: wrong crc', build([{ name: 'a.json', data: MANIFEST, crc: 0x12345678 }]))
push('payload: deflate wrong crc', build([{ name: 'a.json', data: MANIFEST, method: 8, crc: 0x12345678 }]))
push(
  'payload: compressed size runs past the boundary',
  build([
    {
      name: 'a.json',
      data: MANIFEST,
      method: 8,
      payload: deflated(MANIFEST),
      csize: deflated(MANIFEST).length + 5,
    },
    { name: 'b.json', data: MANIFEST },
  ])
)

// --- write, then prove every line is JSON and every case is distinct ---------------
const text = cases.map((item) => JSON.stringify(item.line)).join('\n') + '\n'
writeFileSync(new URL('./cases-extra.jsonl', import.meta.url), text)

const lines = readFileSync(new URL('./cases-extra.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter((line) => line.length > 0)
const seen = new Map()
lines.forEach((line, index) => {
  const parsed = JSON.parse(line)
  if (parsed.fn !== 'parseArchiveBase64') throw new Error(`line ${index}: bad fn`)
  if (parsed.args.length !== 1 || typeof parsed.args[0] !== 'string') {
    throw new Error(`line ${index}: args must be one string`)
  }
  if (seen.has(parsed.args[0])) throw new Error(`line ${index}: duplicate of "${seen.get(parsed.args[0])}"`)
  seen.set(parsed.args[0], cases[index].label)
})
if (lines.length !== cases.length) throw new Error('line count mismatch')
writeFileSync(
  new URL('./case-labels.json', import.meta.url),
  JSON.stringify(Object.fromEntries(cases.map((item) => [item.line.args[0], item.label])), null, 2)
)
console.log(`cases-extra.jsonl: ${lines.length} lines, all valid JSON, all distinct inputs`)
