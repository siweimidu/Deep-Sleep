// Writes cases-extra.jsonl: the hand-written corpus for toLocalSession.
// Every fragment type, image handling, the rejection paths, and the date/URL edges.
import { writeFileSync } from 'node:fs'

const NAN = { $num: 'NaN' }
const cases = []
const add = (file) => cases.push({ fn: 'toLocalSession', args: [file] })

const session = (over = {}) => ({
  id: 'sess-1',
  title: 'Title',
  pinned: false,
  current_message_id: 2,
  inserted_at: '2026-11-11T02:33:23.270Z',
  updated_at: '2026-11-12T04:05:06.000Z',
  messages: [],
  ...over,
})
const msg = (id, parent_id, role, fragments, over = {}) => ({
  id,
  parent_id,
  role,
  status: 'FINISHED',
  thinking_enabled: false,
  search_enabled: false,
  accumulated_token_usage: 0,
  inserted_at: '2026-11-11T02:33:23.270Z',
  fragments,
  ...over,
})
const req = (content) => ({ type: 'REQUEST', content })
const res = (content) => ({ type: 'RESPONSE', content })
// A user turn and an assistant turn, current on the assistant; `over` lands on the assistant.
const pair = (assistantFragments, over = {}) =>
  session({
    current_message_id: 2,
    messages: [msg(1, null, 'USER', [req('hi')]), msg(2, 1, 'ASSISTANT', assistantFragments, over)],
  })

// ---------------------------------------------------------------- structure
add(session({ current_message_id: 2, messages: [msg(1, null, 'USER', [req('hi')]), msg(2, 1, 'ASSISTANT', [res('hello')])] }))
add(session({ current_message_id: 1, messages: [msg(1, null, 'USER', [req('hi')]), msg(2, 1, 'ASSISTANT', [res('hello')])] }))
add(session({ title: null, messages: [] }))
add(session({ title: '', pinned: true, messages: [] }))
add(session({
  current_message_id: 4,
  messages: [
    msg(1, null, 'USER', [req('a')]),
    msg(2, 1, 'ASSISTANT', [res('b')]),
    msg(3, 2, 'USER', [req('c')]),
    msg(4, 3, 'ASSISTANT', [res('d')]),
  ],
}))
add(session({
  current_message_id: 2,
  messages: [msg(1, null, 'USER', [req('a')]), msg(2, 1, 'ASSISTANT', [res('b')]), msg(3, 1, 'ASSISTANT', [res('c')])],
}))
add(session({
  current_message_id: 3,
  messages: [msg(1, null, 'USER', [req('a')]), msg(2, 1, 'ASSISTANT', [res('b')]), msg(3, 1, 'ASSISTANT', [res('c')])],
}))
add(session({ current_message_id: 1.5, messages: [msg(1.5, null, 'USER', [req('frac')])] }))
add(session({ current_message_id: 1e21, messages: [msg(1e21, null, 'USER', [req('big')])] }))
add(session({ current_message_id: NAN, messages: [msg(NAN, null, 'USER', [req('nan')])] }))
add(session({
  current_message_id: -1,
  messages: [msg(-3, null, 'USER', [req('neg')]), msg(-1, -3, 'ASSISTANT', [res('neg-reply')])],
}))
add(session({
  current_message_id: 4,
  messages: [msg(4, 3, 'ASSISTANT', [res('d')]), msg(2, 1, 'ASSISTANT', [res('b')]), msg(1, null, 'USER', [req('a')]), msg(3, 2, 'USER', [req('c')])],
}))
add(session({ current_message_id: 0, messages: [msg(0, null, 'USER', [req('zero')])] }))
add(session({ current_message_id: 2, title: '', messages: [msg(1, null, 'USER', [req('multi'), req('request')]), msg(2, 1, 'ASSISTANT', [res('x')])] }))

// ----------------------------------------------------------- every fragment
add(pair([res('answer only')]))
add(pair([{ type: 'TEMPLATE_RESPONSE', content: 'server template' }]))
add(pair([{ type: 'THINK', content: 'thinking hard', elapsed_secs: 3.5 }]))
add(pair([{ type: 'THINK', content: 'no timing', elapsed_secs: null }]))
add(pair([{ type: 'THINK', content: 'zero timing', elapsed_secs: 0 }]))
add(pair([
  { type: 'TIP', content: 'a tip', style: 'INFO' },
  { type: 'CONTENT_RISK', content: 'risk', style: 'CAUTION' },
  { type: 'PARTIAL_FILE_READ', ratio: 42 },
  res('after dropped fragments'),
]))
add(pair([{ type: 'TOOL_SEARCH', queries: ['deepseek rust'], results: [], status: 'WIP' }]))
add(pair([{
  type: 'TOOL_SEARCH',
  queries: ['rust bridge'],
  status: 'FINISHED',
  stage_id: 2,
  group_id: 7,
  results: [
    { url: 'https://a.example/1', title: 'One', snippet: 'first', published_at: '2026-01-02T03:04:05Z', site_name: 'Example', site_icon: 'https://a.example/icon.png' },
    { url: 'ftp://bad.example/x', title: 'Dropped', snippet: 'nope', published_at: null, site_name: null, site_icon: 'javascript:alert(1)' },
    { url: 'http://b.example/2', title: 'Two', snippet: 'second', published_at: null, site_name: null },
  ],
}]))
add(pair([{ type: 'TOOL_SEARCH', queries: ['failing'], results: [], status: 'FAILED' }]))
add(pair([{ type: 'TOOL_SEARCH', queries: ['no status'], results: [{ url: 'https://c.example/', title: 'C', snippet: 's', published_at: null, site_name: 'C' }] }]))
add(pair([
  { type: 'TOOL_SEARCH', queries: ['with open'], results: [{ url: 'https://d.example/', title: 'D', snippet: '', published_at: null, site_name: null }], status: 'FINISHED' },
  { type: 'TOOL_OPEN', status: 'FINISHED', url: 'https://d.example/page', title: 'Page', snippet: null, site_name: 'D', published_at: null, stage_id: 1, group_id: 2 },
]))
add(pair([
  { type: 'TOOL_SEARCH', queries: ['with find'], results: [], status: 'FINISHED' },
  { type: 'TOOL_FIND', status: 'FINISHED', pattern: 'needle' },
]))
add(pair([{ type: 'TOOL_SEARCH', queries: [], results: [], status: 'FINISHED' }]))
add(pair([{ type: 'TOOL_OPEN', status: 'FINISHED', url: 'https://e.example/x', title: 'Title E', published_at: '2026-02-03T04:05:06.789Z' }]))
add(pair([{ type: 'TOOL_OPEN', status: 'WIP', url: 'https://f.example/x', title: null, published_at: null }]))
add(pair([{ type: 'TOOL_OPEN', status: 'FAILED', url: 'https://g.example/x', title: null, published_at: null }]))
add(pair([{ type: 'TOOL_OPEN', status: 'FINISHED', url: null, title: null, published_at: null }, res('after no url')]))
add(pair([{ type: 'TOOL_OPEN', status: 'FINISHED', url: 'ftp://h.example/', title: 'H', published_at: null }, res('after ftp')]))
add(pair([{ type: 'TOOL_OPEN', status: 'FINISHED', url: '', title: 'Empty', published_at: null }]))
add(pair([{ type: 'TOOL_FIND', status: 'FINISHED', pattern: 'needle' }]))
add(pair([{ type: 'TOOL_FIND', status: 'WIP', pattern: 'needle' }]))
add(pair([{ type: 'TOOL_FIND', status: 'NO_RESULT', pattern: 'needle' }]))
add(pair([{ type: 'TOOL_FIND', status: 'FAILED', pattern: 'needle' }]))
add(pair([{ type: 'TOOL_FIND', status: 'FINISHED' }]))
add(pair([{ type: 'READ_LINK', results: [{ url: 'https://i.example/post', title: 'Post', signature: 'sig-1' }] }]))
add(pair([{ type: 'READ_LINK', results: [{ url: '', title: 'No url', signature: 'sig-2' }] }]))
add(pair([{ type: 'READ_LINK', results: [{ url: 'not a url', title: null, signature: 'sig-3' }] }]))
add(pair([{ type: 'READ_LINK', results: [{ url: 'not a url', title: null, signature: '' }] }, res('after dropped read link')]))
add(pair([{ type: 'READ_LINK', results: [{ url: 'not a url', signature: '   ' }] }]))
add(pair([{
  type: 'READ_LINK',
  results: [
    { url: 'https://j.example/1', title: 'J1', signature: 'a' },
    { url: 'https://j.example/2', title: null, signature: 'b' },
    { signature: 'only-signature' },
  ],
}]))
add(pair([{ type: 'TOOL_IMAGE_SEARCH', status: 'FINISHED', image_indexes: [0, 1], results: [{ title: 'img', source_page_url: 'https://k.example/', snippet: 's', site_name: 'K', published_at: null }] }]))
add(pair([{ type: 'SOMETHING_NEW', content: 'unknown fragment' }, res('after unknown')]))
add(pair([res('a'), res('b'), { type: 'THINK', content: 'c', elapsed_secs: 1 }]))

// ------------------------------------------------------------------- files
const dir = 'chat_sessions/sess-1_files/'
const entry = (over = {}) => ({
  id: 'file-1',
  file_name: 'photo.png',
  file_size: 1024,
  token_usage: null,
  inserted_at: '2026-11-11T02:33:23.270Z',
  export_path: dir + 'file-1_photo.png',
  is_image: true,
  width: 10,
  height: 20,
  ...over,
})
add(pair([{ type: 'FILE', files: [entry({ is_image: false, id: 'file-2', file_name: 'doc.pdf', export_path: null })] }]))
add(pair([{ type: 'FILE', files: [entry()] }]))
add(pair([{ type: 'FILE', files: [entry({ export_path: null })] }]))
add(pair([{ type: 'FILE', files: [entry({ export_path: dir + 'file-1_b.png' }), entry({ export_path: dir + 'file-1_b.png' })] }]))
add(pair([{ type: 'FILE', files: [entry()] }, { type: 'FILE', files: [entry()] }]))
// NFD and NFC of one path must collapse onto the same entry.
const nfc = 'chat_sessions/sess-1_files/file-1_café.png'
const nfd = nfc.normalize('NFD')
add(pair([{ type: 'FILE', files: [
  entry({ id: 'file-9', export_path: nfd, file_name: 'café.png' }),
  entry({ id: 'file-9', export_path: nfc, file_name: 'café.png' }),
] }]))
add(pair([{ type: 'FILE', files: [entry({ export_path: 'other_files/file-1_photo.png' })] }]))
add(pair([{ type: 'FILE', files: [entry({ export_path: 'chat_sessions/sess-1_files' })] }]))
add(pair([{ type: 'FILE', files: [entry({ export_path: dir + 'file-1_b.png' }), entry({ export_path: dir + 'file-1_b.png', id: 'file-3' })] }]))
add(session({ id: 'sess/1', current_message_id: 1, messages: [msg(1, null, 'USER', [{ type: 'FILE', files: [entry({ export_path: 'chat_sessions/sess/1_files/file-1_photo.png' })] }])] }))

// ---------------------------------------------------------------- statuses
for (const status of ['FINISHED', 'CONTENT_FILTER', 'FAILED', 'CONTEXT_LENGTH_EXCEEDED', 'INCOMPLETE', 'TIMEOUT', 'WIP']) {
  add(pair([{ type: 'THINK', content: 'tk', elapsed_secs: 2 }, res('body'), { type: 'TEMPLATE_RESPONSE', content: 'tmpl' }], { status }))
}
add(pair([{ type: 'THINK', content: 'tk', elapsed_secs: null }, res('body'), { type: 'TEMPLATE_RESPONSE', content: 'tmpl' }, res('trailing')], { status: 'CONTENT_FILTER' }))
add(pair([res('flags on')], { thinking_enabled: true, search_enabled: true, accumulated_token_usage: 1234 }))
add(pair([], { status: 'WIP' }))

// ------------------------------------------------------------------- dates
for (const at of [
  '2026-11-11T02:33:23.270Z',
  '2026-11-11T02:33:23.2Z',
  '2026-11-11T02:33:23.270123Z',
  '2026-11-11T02:33:23+05:30',
  '2026-11-11',
  '2026-11',
  '2026',
  '2026-11-11t02:33:23z',
  '2026-11-11T24:00:00Z',
  '1969-12-31T23:59:59.999Z',
  '2026-02-30T00:00:00Z',
  '2026-11-11T02:33:23',
  'not a date',
  '',
  '2026-13-01T00:00:00Z',
  ' 2026-11-11T02:33:23.270Z',
]) {
  add(session({ inserted_at: at, updated_at: at, current_message_id: 1, messages: [msg(1, null, 'USER', [req(at)])] }))
}
add(session({ inserted_at: null, updated_at: null, messages: [] }))

// -------------------------------------------------------------- rejections
add(session({ messages: [msg(1, null, 'USER', [req('a')]), msg(1, null, 'USER', [req('b')])], current_message_id: 1 }))
add(session({ messages: [msg(1, null, 'ASSISTANT', [res('a')])], current_message_id: 1 }))
add(session({ messages: [msg(2, 1, 'ASSISTANT', [res('a')])], current_message_id: 2 }))
add(session({ messages: [msg(1, null, 'USER', [req('a')]), msg(2, 1, 'USER', [req('b')])], current_message_id: 2 }))
add(session({ messages: [msg(1, null, 'USER', [req('a')])], current_message_id: 7 }))
add(session({ messages: [msg(NAN, null, 'USER', [req('a')]), msg(NAN, 1, 'ASSISTANT', [res('b')])], current_message_id: NAN }))
add(session({ messages: [msg(1, null, 'USER', [req('a')]), msg(2, 1, 'ASSISTANT', []), msg(2, 2, 'USER', [req('c')])], current_message_id: 1 }))
add(session({ messages: [msg(1, null, 'USER')], current_message_id: 1 }))
add(pair([{ type: 'TOOL_SEARCH', results: [], status: 'FINISHED' }]))
add(pair([{ type: 'READ_LINK', results: [{ url: 'https://x.example/' }] }]))
add(pair([{ type: 'FILE', files: [null] }]))
cases.push({ fn: 'toLocalSession', args: [null] })
cases.push({ fn: 'toLocalSession', args: ['a string'] })
cases.push({ fn: 'toLocalSession', args: [{}] })
cases.push({ fn: 'toLocalSession', args: [session({ messages: { length: 0 } })] })

// ------------------------------------------------- edges the round-trip must also hold
// A question that carries attachments: `files` is filled from the same fragments.
const userFiles = session({
  current_message_id: 2,
  messages: [
    msg(1, null, 'USER', [
      { type: 'REQUEST', content: 'look at this' },
      { type: 'FILE', files: [entry({ id: 'file-1', export_path: dir + 'file-1_photo.png' })] },
      { type: 'FILE', files: [entry({ id: 'file-2', file_name: 'doc.pdf', is_image: false, export_path: dir + 'file-2_doc.pdf' })] },
      { type: 'TIP', content: 'tip' },
    ]),
    msg(2, 1, 'ASSISTANT', [res('nice')]),
  ],
})
add(userFiles)
// Keys that are simply absent: `content`, `elapsed_secs`, `title`, `pattern`.
add(pair([{ type: 'THINK', content: 'no elapsed key' }, { type: 'RESPONSE' }, { type: 'TOOL_FIND', status: 'FINISHED', pattern: null }]))
add(session({ title: undefined, messages: [] }))
// A URL that only survives the parser: upper case, surrounding space, an inner tab.
add(pair([{ type: 'TOOL_OPEN', status: 'FINISHED', url: 'HTTP://A.B/c', title: 'Upper', published_at: null }]))
add(pair([{ type: 'TOOL_OPEN', status: 'FINISHED', url: '  https://spaced.example/x  ', title: null, published_at: null }]))
add(pair([{ type: 'TOOL_SEARCH', queries: [''], status: 'FINISHED', results: [
  { url: 'https://ok.example/\tpath', title: 'Tabbed', snippet: null, published_at: null, site_name: null, site_icon: null },
  { url: null, title: 'No url', snippet: null, published_at: null, site_name: null },
  { url: 'https://a.b:99999/x', title: 'Bad port', snippet: null, published_at: null, site_name: null },
  { url: 'https://', title: 'No host', snippet: null, published_at: null, site_name: null },
] }]))
// An image entry with no id: the caller gets `undefined` as the file id.
add(pair([{ type: 'FILE', files: [entry({ id: undefined, export_path: dir + 'nameless.png' })] }]))
add(pair([{ type: 'FILE', files: [entry({ export_path: '' })] }]))
add(pair([{ type: 'READ_LINK', results: [{ url: 'nope', title: 'Kept', signature: 'sig' }] }]))
add(pair([res('statusless')], { status: undefined }))

// Nullish pieces inside the archive, so the failure a damaged file produces is the same one.
add(pair([null]))
add(session({ current_message_id: 1, messages: [msg(1, null, 'USER', [null])] }))
add(session({ current_message_id: 1, messages: [null] }))
add(session({ current_message_id: 2, messages: [null, msg(2, 1, 'ASSISTANT', [res('x')])] }))
add(pair([{ type: 'TOOL_SEARCH', queries: ['null result'], status: 'FINISHED', results: [null] }]))
add(pair([{ type: 'TOOL_OPEN', status: 'FINISHED', url: 'http://only-url.example/' }]))

// `undefined` crosses as the record codec's marker; absent and undefined read the same.
const marker = (v) => {
  if (v === undefined) return { $undefined: true }
  if (Array.isArray(v)) return v.map(marker)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, marker(x)]))
  return v
}
const lines = cases.map((c) => JSON.stringify(marker(c)))
lines.forEach((line, i) => {
  JSON.parse(line)
  if (line.charCodeAt(0) === 0xfeff) throw new Error(`BOM at ${i}`)
})
writeFileSync(process.argv[2], lines.join('\n') + '\n', 'utf8')
console.log(`wrote ${lines.length} cases`)
