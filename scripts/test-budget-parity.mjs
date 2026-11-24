// token 估算的 TS/wasm 一致性检查。
// 运行：node --no-warnings scripts/test-budget-parity.mjs
//
// 为什么必须有这一条：App 里 ≥512 字符走 wasm、更短走 TS 兜底，两条路径若公式不一致，
// 同一个会话在不同长度上会得到矛盾的预算；Rust 的 gate 只保证「与录制时一致」，
// 不保证「与当前 TS 一致」，所以这里直接对拍。
import { readFileSync } from 'node:fs'
import init, { estimateTokens as rustEstimate } from '../src/rust-core/pkg/budget_rs.js'

await init({ module_or_path: readFileSync(new URL('../src/rust-core/pkg/budget_rs_bg.wasm', import.meta.url)) })

const weightOf = (code) => {
  if (code >= 0x1f000) {
    return 2
  }
  if (code >= 0x10000) {
    return 1.2
  }
  if (code >= 0x2e80) {
    return 1
  }
  if (code <= 0x7f) {
    const alnum =
      (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)
    const blank = code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d
    return alnum || blank ? 0.25 : 0.4
  }
  return code <= 0x3ff ? 0.5 : 0.34
}

const tsEstimate = (text) => {
  if (!text) {
    return 0
  }
  let total = 0
  for (const char of text) {
    total += weightOf(char.codePointAt(0) ?? 0)
  }
  return Math.ceil(total)
}

const samples = [
  'hello world',
  'const x = {a: 1, b: [2, 3]};',
  '你好，世界',
  '这是一段中文，混着 English words 和 😀🎉 emoji',
  'Привет мир',
  'a'.repeat(600),
  '中文'.repeat(300),
  '😀'.repeat(50),
  '\n\t  ',
  '',
]

let failed = 0
for (const text of samples) {
  const ts = tsEstimate(text)
  const rust = rustEstimate(text)
  if (ts !== rust) {
    failed += 1
    console.log('  ✗', JSON.stringify(text.slice(0, 20)), 'ts=' + ts, 'rust=' + rust)
  } else {
    console.log('  ✓', JSON.stringify(text.slice(0, 20)) || "''", '=', ts)
  }
}
console.log(failed === 0 ? '\nTS 与 wasm 完全一致' : '\n不一致 ' + failed + ' 例')
process.exit(failed === 0 ? 0 : 1)
