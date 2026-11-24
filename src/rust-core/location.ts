/**
 * Rust 核心适配层：地区名称与位置归一化（`location-rs`）。
 *
 * 与另外两个适配层同样的约定：能拿到 wasm 就走 Rust，拿不到返回 `undefined` 让调用方回退原实现。
 *
 * 两个导出的返回编码**不一样**（这是浏览器胶水的真实差异，别统一处理）：
 * - `getRegionName` → 直接返回字符串；
 * - `normalizeLocation` → 返回 `serde_json::Value`，浏览器胶水编码成 JSON 文本，必须 `JSON.parse`。
 */
import init, {
  getRegionName as rustGetRegionName,
  normalizeLocation as rustNormalizeLocation,
} from './pkg/location_rs.js'

export type RustUserLocation = { region: string; province?: string; city?: string }

let ready = false

const load = async (): Promise<void> => {
  try {
    await init({ module_or_path: new URL('./pkg/location_rs_bg.wasm', import.meta.url) })
    ready = true
  } catch {
    // Rust 是加速路径，不是依赖：加载失败就永远走原 TS 实现。
  }
}

void load()

export const rustLocation = {
  getRegionName: (code: string, locale: 'zh-CN' | 'en-US'): string | undefined =>
    ready ? rustGetRegionName(code, locale) : undefined,

  normalizeLocation: (value: unknown): RustUserLocation | null | undefined => {
    if (!ready) {
      return undefined
    }
    // `undefined` 在 wire 上是专门的标记，不能直接 stringify（那会返回 undefined 本身）。
    const encoded = value === undefined ? '{"$undefined":true}' : JSON.stringify(value)
    const parsed: unknown = JSON.parse(rustNormalizeLocation(encoded))
    return parsed as RustUserLocation | null
  },
}
