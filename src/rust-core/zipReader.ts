/**
 * Rust 核心适配层：归档目录解析（`zipreader-rs`）。
 *
 * 这是**唯一实测划算**的接入点：一次调用要解析整个归档（1.1 MB / 41 条），
 * `rust/bench-archive.mjs` 测到 Rust 19.36 ms vs TypeScript 109.22 ms（**快 5.6 倍**，输出逐字节一致）。
 * 对比之下整对象变换走 wasm 会慢 30–90 倍，所以那类单元刻意不接。
 *
 * 失败语义刻意保留给 TS：Rust 出错时这里返回 `undefined`，调用方继续走原 TS 实现，
 * 由它抛出 `ArchiveError` —— 这样"解不出来的归档报什么错、报什么类型"完全不变。
 */
import init, { parseArchiveBase64 as rustParseArchiveBase64 } from './pkg/zipreader_rs.js'

export type RustParsedArchiveEntry = {
  path: string
  size: number
  flags: number
  method: number
  crc: number
  compressedSize: number
  offset: number
  start: number
}

export type RustParsedArchive = { offset: number; entries: RustParsedArchiveEntry[] }

let ready = false

/**
 * 诊断用：真机/模拟器上用 CDP 读 `window.__deepseekRust.zipReader` 就能确认 wasm 是否真的初始化成功。
 * 这是设备验证唯一可靠的信号（Node 环境没有 window，直接跳过）。
 */
const publish = (value: boolean): void => {
  if (typeof window === 'undefined') {
    return
  }
  const scope = window as unknown as { __deepseekRust?: Record<string, boolean> }
  scope.__deepseekRust = { ...scope.__deepseekRust, zipReader: value }
}

const load = async (): Promise<void> => {
  try {
    await init({ module_or_path: new URL('./pkg/zipreader_rs_bg.wasm', import.meta.url) })
    ready = true
    publish(true)
  } catch {
    // Rust 是加速路径，不是依赖：加载失败就永远走原 TS 实现。
    publish(false)
  }
}

void load()

/** 仅供诊断：wasm 是否初始化成功（生产代码路径不应依赖它）。 */
export const isRustZipReaderReady = (): boolean => ready

export const rustZipReader = {
  parseArchiveBase64: async (base64: string): Promise<RustParsedArchive | undefined> => {
    if (!ready) {
      return undefined
    }
    try {
      // 该 crate 的导出返回 serde_json::Value，浏览器胶水编码成 JSON 文本。
      const parsed: unknown = JSON.parse(await rustParseArchiveBase64(base64))
      return parsed as RustParsedArchive
    } catch {
      // 让 TS 去决定这是个什么错误（ArchiveError，带正确的 key）。
      return undefined
    }
  },
}
