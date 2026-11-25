// 会话解析：worker 失败必须回退到主线程，而不是让导入失败。
// 运行：node --experimental-transform-types --no-warnings --import ./rust/register-ts.mjs scripts/test-parse-fallback.mjs
//
// 用真实归档里的会话文件（官方 chat_sessions 格式），把正文撑到 8KB 阈值以上，
// 再伪造一个"一创建就报错"的 Worker，断言解析仍然成功。
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

const zipPath = process.argv[2] ?? process.env.TEMP + '/ds-export.zip'

const readFirstSession = (path) => {
  const buf = readFileSync(path)
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    if (name.startsWith('chat_sessions/') && name.endsWith('.json')) {
      const lNameLen = buf.readUInt16LE(localOff + 26)
      const lExtraLen = buf.readUInt16LE(localOff + 28)
      const start = localOff + 30 + lNameLen + lExtraLen
      const raw = buf.subarray(start, start + csize)
      return (method === 8 ? inflateRawSync(raw) : raw).toString('utf8')
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  throw new Error('no session entry in ' + path)
}

const raw = readFirstSession(zipPath)
const file = JSON.parse(raw)

// 把某条消息的正文撑大，确保超过 worker 的 8KB 阈值
const big = '这是一段被撑长的正文，用来越过 8KB 阈值。'.repeat(400)
const target = (file.messages ?? file.chat_messages ?? [])[0]
if (target) {
  if (typeof target.content === 'string') {
    target.content = target.content + big
  } else if (target.fragments) {
    target.fragments.push({ type: 'REQUEST', content: big })
  }
}
const text = JSON.stringify(file)
console.log('样例长度:', text.length, '（阈值 8192）')

// 伪造一个必定失败的 Worker
let created = 0
globalThis.Worker = class {
  constructor() {
    created += 1
    // 异步触发 onerror，模拟 Worker 启动即崩
    setTimeout(() => this.onerror?.(new Error('simulated worker crash')), 0)
  }
  postMessage() {}
  terminate() {}
}
globalThis.document = { baseURI: 'http://localhost/' }

const { parseSessionText } = await import(
  new URL('../src/services/chat/history/parseWorker.ts', import.meta.url).href
)

let failed = 0
const check = (name, ok, extra = '') => {
  if (ok) {
    console.log('  ✓', name)
  } else {
    failed += 1
    console.log('  ✗', name, extra)
  }
}

const parsed = await parseSessionText(text).catch((error) => ({ error }))
check('worker 崩溃时仍解析成功（回退主线程）', Boolean(parsed?.session), JSON.stringify(parsed?.error ?? '').slice(0, 120))
check('确实尝试过 worker', created > 0, 'created=' + created)
check('返回的图片是 Map', parsed?.images instanceof Map)

// 小文本走就地解析，不该创建 worker
const before = created
const small = JSON.stringify({ ...file, messages: [] })
const smallParsed = await parseSessionText(small).catch((error) => ({ error }))
check('小文本就地解析', Boolean(smallParsed?.session), JSON.stringify(smallParsed?.error ?? '').slice(0, 120))
check('小文本不创建 worker', created === before, `${before} -> ${created}`)

console.log(failed === 0 ? '\n全部通过' : '\n失败 ' + failed + ' 项')
process.exit(failed === 0 ? 0 : 1)
