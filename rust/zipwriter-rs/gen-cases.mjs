// Builds cases-extra.jsonl for `writeArchive` (src/services/chat/history/zipWriter.ts).
// Run: node gen-cases.mjs > cases-extra.jsonl
const cases = []
const push = (entries) => cases.push({ fn: 'writeArchive', args: [entries] })
const one = (name, blob) => push([{ name, blob }])
const big = 4294967295 // ZIP64_SIZE

// --- the argument is not an array -------------------------------------------------
push('abc')
push(42)
push(0)
push(null)
push(true)
push({})
push({ length: 3 })
push({ length: 70000 })
push(Array.from({ length: 65535 }, () => 0)) // length sentinel: 0xffff
cases.push({ fn: 'writeArchive', args: [] }) // undefined
cases.push({ fn: 'writeArchive', args: [{ $undefined: true }] })

// --- one well-formed entry: the name rules (blob.size = sentinel keeps the run short)
const sentinel = { size: big }
const zero = { size: 0 }
// A JS string that is not well-formed crosses the wire as its UTF-16 code units.
const units = (s) => ({ $utf16: Array.from({ length: s.length }, (_, i) => s.charCodeAt(i)) })
const loneHigh = units(String.fromCharCode(0xd800))
const loneLow = units(String.fromCharCode(97, 0xdc00, 98))
for (const name of [
  '', // empty
  'a\\b', // backslash
  '\\a',
  'a\0b', // NUL
  'a\0',
  'C:/a', // drive letter
  'c:x',
  'AB:/x',
  '/a', // absolute
  'a//b', // empty segment
  'a/',
  './a', // dot segment
  'a/./b',
  'a/../b',
  '..',
  '.',
  'a..b', // valid: '..' only as a whole segment is rejected
  'a:b', // valid: not a drive letter
  '_a:/x', // valid
  'manifest.json',
  'chat_sessions/x/manifest.json',
  'e\u0301', // NFD
  '\u00e9', // NFC
  loneHigh, // lone high surrogate
  loneLow, // lone low surrogate
  'e\u0301\\x', // decomposed + backslash
]) one(name, sentinel)

// --- name byte-length boundary (0xffff bytes of UTF-8) ---------------------------
one('a'.repeat(65536), zero) // 65536 bytes -> limit
one('a'.repeat(65535), zero) // 65535 bytes -> accepted, then the Blob boundary
one('\u00e9'.repeat(32768), zero) // 65536 bytes -> limit
one('\u00e9'.repeat(32767), zero) // 65534 bytes -> accepted
one('a/' + 'b'.repeat(65533), zero) // 65535 bytes across two segments -> acceptedx
one('a/' + 'b'.repeat(65534), zero) // 65536 bytes -> limit

// --- duplicates (compared after NFC) ---------------------------------------------
push([{ name: 'a.json', blob: zero }, { name: 'a.json', blob: zero }])
push([{ name: '\u00e9', blob: zero }, { name: 'e\u0301', blob: zero }])
push([{ name: 'a', blob: zero }, { name: 'A', blob: zero }]) // case-sensitive: no duplicate
push([{ name: 'a', blob: zero }, { name: 'b', blob: zero }, { name: 'a', blob: zero }])

// --- blob.size sentinel and the running totals ------------------------------------
one('a', { size: big })
one('a', { size: big - 1 })
one('a', { size: big - 95 }) // exactly at the limit
one('a', { size: big - 95 + 1 })
one('a', { size: big - 200 })
push([
  { name: 'a', blob: { size: 3000000000 } },
  { name: 'b', blob: { size: 3000000000 } },
]) // the totals overflow on the second entry
one('a', { size: null })
one('a', { size: '5' })
one('a', { size: '4294967200' }) // a string size: JS concatenates inside `dataSize +=`
one('a', { size: true })
one('a', {}) // size undefined

// --- element shapes -----------------------------------------------------------------
push([null])
push([{ a: 'b' }])
push([5])
push(['str'])
push([{}])
push([{ blob: zero }])
push([{ name: 'a' }])
push([{ name: 5, blob: zero }])
push([{ name: null, blob: zero }])
push([{ name: 'a', blob: null }])
push([{ name: 'a', blob: 5 }])

// --- the empty archive: the one input that completes over the wire -----------------
push([])

import { writeFileSync } from 'node:fs'
writeFileSync(new URL('./cases-extra.jsonl', import.meta.url), cases.map(c => JSON.stringify(c) + '\n').join(''))
