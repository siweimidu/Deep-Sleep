// Does archive import belong in Rust? readSessionFile / checkManifest vs the Rust port.
//
//   powershell -NoProfile -ExecutionPolicy Bypass -File rust/build-web-core.ps1 -Crate schema-rs -OutDir "$env:TEMP\bench\schema-rs"
//   node --import ./rust/register-ts.mjs rust/bench/schema.mjs
import { compare, fromWire, initGlue, installFileFetch, loadTs, summarize } from './lib.mjs'

// ...and the app modules need the browser globals first: `window` and the rspack-injected
// `__API_ORIGIN__` are read at module scope. rust/record-shim.mjs is the repo's copy of that shim.
import '../record-shim.mjs'

installFileFetch()
const glue = await initGlue('schema-rs')
const { checkManifest, readSessionFile } = await loadTs('src/services/chat/history/schema.ts')

// serde_json::Value params go in as text, Value results come back as text (ADOPTION.md §4).
const viaRust = async (name, value) => fromWire(await glue[name](JSON.stringify(value)))

// ---------------------------------------------------------------------------------------------
// A realistic `chat_sessions/<id>.json`: alternating USER / ASSISTANT, mixed fragment types,
// stamps 37 s apart, and one regenerated reply that leaves a second child in the tree.
// ---------------------------------------------------------------------------------------------
const SESSION_ID = '9f3c1a7e-2b64-4d18-9a05-6e8f7c2d1b44'
const START = Date.parse('2026-11-02T09:14:07.412Z')
const WORDS = ['上下文', '缓存', '归档', '请求', '片段', '校验', '会话', '分支', '附件', '检索', '响应', 'token']

const stamp = (index) => new Date(START + index * 37_000 + (index % 11) * 137).toISOString()
/** Same instant with microsecond precision, which the format allows and keeps verbatim. */
const micro = (index) => `${stamp(index).slice(0, -1)}${String((index * 61) % 1000).padStart(3, '0')}Z`
const text = (seed, length) => {
  let out = ''
  let value = seed * 7919 + 104729
  while (out.length < length) {
    value = (value * 1103515245 + 12345) % 2147483648
    out += WORDS[value % WORDS.length]
    if (value % 5 === 0) out += '，'
  }
  return `${out.slice(0, length)}。`
}

const fileEntry = (index, position) => {
  const isImage = position % 2 === 0
  const fileId = `file-${index}-${position}`
  const fileName = isImage ? `截图-${index}-${position}.png` : `报告-${index}-${position}.pdf`
  return {
    id: fileId,
    file_name: fileName,
    file_size: 10240 + index * 137 + position * 31,
    token_usage: isImage ? null : 120 + position * 7,
    inserted_at: stamp(index),
    // Only images live next to the session file; other attachments export metadata only.
    export_path: isImage ? `chat_sessions/${SESSION_ID}_files/${fileId}_${fileName}` : null,
    is_image: isImage,
    width: isImage ? 1280 : null,
    height: isImage ? 720 : null,
  }
}

const searchResult = (index, position) => ({
  url: `https://example.com/${index}/${position}?from=search`,
  title: text(index * 3 + position, 36),
  snippet: text(index * 5 + position, 88),
  published_at: position % 3 === 0 ? null : micro(index + position),
  site_name: position % 4 === 0 ? null : 'Example 站点',
  site_icon: position % 5 === 0 ? null : `https://example.com/${position}/icon.png`,
})

const userFragments = (index) => {
  const fragments = []
  if (index % 12 === 0) {
    fragments.push({
      type: 'FILE',
      files: Array.from({ length: 1 + (index % 3) }, (_, position) => fileEntry(index, position)),
    })
  }
  fragments.push({ type: 'REQUEST', content: text(index * 7 + 1, 24 + (index % 90)) })
  return fragments
}

const assistantFragments = (index) => {
  const fragments = [{ type: 'THINK', content: text(index * 13 + 3, 60 + (index % 120)), elapsed_secs: (index % 9) + 0.5 }]
  if (index % 4 === 1) {
    fragments.push({
      type: 'TOOL_SEARCH',
      queries: [`迁移进度 ${index}`, `rust wasm boundary cost ${index}`],
      results: Array.from({ length: 3 + (index % 3) }, (_, position) => searchResult(index, position)),
      status: ['FINISHED', 'FINISHED', 'FINISHED', 'FAILED', 'WIP'][index % 5],
      stage_id: index,
      group_id: index % 3,
    })
  }
  if (index % 10 === 3) {
    fragments.push({
      type: 'TOOL_OPEN',
      status: ['FINISHED', 'FINISHED', 'FAILED'][index % 3],
      url: `https://example.com/doc/${index}`,
      title: text(index * 11, 30),
      snippet: '',
      site_name: 'Example 文档',
      published_at: micro(index),
      stage_id: index,
    })
  }
  if (index % 10 === 7) {
    fragments.push({
      type: 'READ_LINK',
      results: [
        { signature: `sig-${index}-0`, url: `https://example.com/read/${index}`, title: text(index * 17, 28) },
        { signature: `sig-${index}-1` },
      ],
    })
  }
  if (index % 14 === 5) {
    fragments.push({
      type: 'TOOL_IMAGE_SEARCH',
      status: 'FINISHED',
      image_indexes: [0, 1, 2],
      results: Array.from({ length: 2 }, (_, position) => ({
        title: text(index * 19 + position, 26),
        source_page_url: `https://example.com/image/${index}/${position}`,
        snippet: text(index * 23 + position, 70),
        site_name: position === 0 ? null : 'Example 图库',
        published_at: micro(index + position),
      })),
    })
  }
  if (index % 16 === 9) {
    fragments.push({ type: 'PARTIAL_FILE_READ', ratio: 42.5 })
  }
  if (index % 18 === 11) {
    fragments.push({ type: 'TIP', content: text(index * 29, 40), style: 'WARNING' })
  }
  if (index % 22 === 13) {
    fragments.push({ type: 'CONTENT_RISK', content: text(index * 31, 46), style: 'CAUTION' })
  }
  if (index % 26 === 15) {
    fragments.push({ type: 'TEMPLATE_RESPONSE', content: text(index * 37, 52) })
  }
  fragments.push({ type: 'RESPONSE', content: text(index * 41 + 5, 240 + (index % 400)) })
  return fragments
}

const statuses = ['FINISHED', 'FINISHED', 'FINISHED', 'INCOMPLETE', 'FAILED', 'FINISHED', 'TIMEOUT', 'CONTENT_FILTER']

const buildSession = (count) => {
  const messages = []
  let nextId = 1
  let previous = null
  const emit = (role, status, fragments, index) => {
    const message = {
      id: nextId,
      parent_id: previous,
      role,
      status,
      thinking_enabled: index % 3 !== 0,
      search_enabled: index % 4 === 1,
      accumulated_token_usage: Math.round(1200 + index * 437.9),
      inserted_at: stamp(index),
      fragments,
    }
    nextId += 1
    messages.push(message)
    previous = message.id
    return message
  }
  for (let index = 0; index < count; index += 1) {
    if (index % 2 === 0) {
      emit('USER', 'FINISHED', userFragments(index), index)
      continue
    }
    const spine = emit('ASSISTANT', statuses[index % statuses.length], assistantFragments(index), index)
    // A regenerated reply: second child of the same question, abandoned and not on the current path.
    if (index === 3 && count >= 20) {
      messages.push({
        ...spine,
        id: nextId,
        status: 'INCOMPLETE',
        fragments: [{ type: 'RESPONSE', content: text(index * 97, 180) }],
      })
      nextId += 1
    }
  }
  return messages
}

const sessionFile = (count) => {
  const messages = buildSession(count)
  return {
    id: SESSION_ID,
    title: '把 Rust 核心接进 Android WebView',
    pinned: false,
    current_message_id: messages[messages.length - 1].id,
    inserted_at: stamp(0),
    updated_at: stamp(count * 2),
    messages,
  }
}

const large = sessionFile(200)
const small = sessionFile(5)
const manifest = { export_format_version: 3 }

const sizeOf = (value) => `${(Buffer.byteLength(JSON.stringify(value)) / 1024).toFixed(1)} KB`
console.log(`INPUT schema large=${sizeOf(large)} messages=${large.messages.length} small=${sizeOf(small)} messages=${small.messages.length}`)

// Guard against timing an early return: the validated copy must still carry every message.
const parsed = readSessionFile(large)
console.log(
  `CHECK schema messages=${parsed.messages.length} fragments=${parsed.messages.reduce((n, message) => n + message.fragments.length, 0)} out=${sizeOf(parsed)}`,
)

const results = []
for (const [label, input, iterations] of [
  ['large', large, 200],
  ['small', small, 3000],
]) {
  results.push(
    await compare({
      crate: 'schema',
      fn: `readSessionFile.${label}`,
      iterations,
      ts: async () => readSessionFile(input),
      rust: async () => viaRust('readSessionFile', input),
    }),
  )
}
results.push(
  await compare({
    crate: 'schema',
    fn: 'checkManifest',
    iterations: 20000,
    // Both sides "return" nothing; checkManifest either throws or passes.
    ts: async () => {
      checkManifest(manifest)
      return undefined
    },
    rust: async () => viaRust('checkManifest', manifest),
  }),
)
summarize('schema', results)
