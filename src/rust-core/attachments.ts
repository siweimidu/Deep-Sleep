/**
 * Rust 核心适配层：上传分类（`attachments-rs`）。
 *
 * 与 `paths.ts` 同样的约定：能拿到 wasm 就走 Rust，拿不到返回 `undefined` 让调用方回退原实现。
 * `undefined` 专用于"未就绪"，因为 `null` 是 `getUploadPurpose` 的合法返回值。
 *
 * 该 crate 的每个导出在 Rust 侧都返回 `serde_json::Value`，浏览器胶水把它编码成 **JSON 文本**，
 * 所以这里统一 `JSON.parse`（Node 胶水才会自动解析，两者不等价，见 ADOPTION.md）。
 */
import init, {
  formatSize as rustFormatSize,
  getExtension as rustGetExtension,
  getFileExt as rustGetFileExt,
  getUploadPurpose as rustGetUploadPurpose,
  isAcceptedExt as rustIsAcceptedExt,
  isImage as rustIsImage,
} from './pkg/attachments_rs.js'

let ready = false

const load = async (): Promise<void> => {
  try {
    await init({ module_or_path: new URL('./pkg/attachments_rs_bg.wasm', import.meta.url) })
    ready = true
  } catch {
    // Rust 是加速路径，不是依赖：加载失败就永远走原 TS 实现。
  }
}

void load()

const decode = (raw: string): unknown => JSON.parse(raw)

const when =
  <A extends unknown[], R>(call: (...args: A) => string) =>
  (...args: A): R | undefined =>
    ready ? (decode(call(...args)) as R) : undefined

export const rustAttachments = {
  getFileExt: when<[string], string>(rustGetFileExt),
  isAcceptedExt: when<[string], boolean>(rustIsAcceptedExt),
  getUploadPurpose: when<[string, boolean], string | null>(rustGetUploadPurpose),
  isImage: when<[string], boolean>(rustIsImage),
  getExtension: when<[string], string>(rustGetExtension),
  formatSize: when<[number], string>(rustFormatSize),
}
