/**
 * Rust 核心适配层（`store` 里的 wasm）。
 *
 * 行为由 `rust/web-parity.ps1` 对录制语料逐条验证过：同一批输入在浏览器产物上与 TS 原版输出一致。
 * 因此这里的每个函数都是「能拿到 wasm 就用 Rust，拿不到就返回 null 让调用方用原 TS 实现」——
 * 初始化失败、wasm 还没加载完、某种环境不支持 WebAssembly，都会自动退回原实现，行为不变。
 *
 * `parseSessionPath` 返回 `undefined` 表示"还没就绪"，因为 `null` 是它的合法返回值。
 */
import init, {
  imagePath as rustImagePath,
  parseSessionPath as rustParseSessionPath,
  sessionFilesDir as rustSessionFilesDir,
  sessionPath as rustSessionPath,
} from './pkg/paths_rs.js'

let ready = false

const load = async (): Promise<void> => {
  try {
    await init({ module_or_path: new URL('./pkg/paths_rs_bg.wasm', import.meta.url) })
    ready = true
  } catch {
    // Rust 是加速路径，不是依赖：加载失败就永远走原 TS 实现。
  }
}

void load()

export const rustPaths = {
  sessionPath: (sessionId: string): string | null => (ready ? rustSessionPath(sessionId) : null),

  sessionFilesDir: (sessionId: string): string | null =>
    ready ? rustSessionFilesDir(sessionId) : null,

  parseSessionPath: (path: string): string | null | undefined => {
    if (!ready) {
      return undefined
    }
    // 浏览器胶水把 serde_json::Value 返回值编码成 JSON 文本（Node 胶水才会自动解析）。
    const result: unknown = JSON.parse(rustParseSessionPath(path))
    return result as string | null
  },

  imagePath: (sessionId: string, fileId: string, fileName: string): string | null =>
    ready ? rustImagePath(sessionId, fileId, fileName) : null,
}
