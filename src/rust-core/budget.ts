/**
 * Rust 核心适配层：token 估算（`budget-rs`）。
 *
 * 这是 12 个未接单元里**唯一实测更快**的一个：`rust/bench/budget.mjs` 测得 ≥128 个 UTF-16 单元时
 * Rust 快 1.2–1.8 倍（1 KB 1.62×、100 KB 1.81×、1 MB 1.71×），但更短时边界成本更贵
 * （16 单元时反而只有 0.64×）。所以**阈值判断放在调用点**，见 `services/chat/context/budget.ts`：
 * 只有够长的文本才走这里。
 *
 * `estimateTokens` 返回 `f64`，浏览器胶水直接给 JS number，没有 JSON 文本那一层。
 */
import init, { estimateTokens as rustEstimateTokens } from './pkg/budget_rs.js'

let ready = false

/** 诊断用，见 zipReader.ts 里同名函数。 */
const publish = (value: boolean, error?: string): void => {
  if (typeof window === 'undefined') {
    return
  }
  const scope = window as unknown as { __deepseekRust?: Record<string, unknown> }
  scope.__deepseekRust = {
    ...scope.__deepseekRust,
    budget: value,
    ...(error === undefined ? {} : { budgetError: error }),
  }
}

const load = async (): Promise<void> => {
  try {
    await init({ module_or_path: new URL('./pkg/budget_rs_bg.wasm', import.meta.url) })
    ready = true
    publish(true)
  } catch (error) {
    // Rust 是加速路径，不是依赖：加载失败就永远走原 TS 实现。
    publish(false, String(error))
  }
}

void load()

/** 仅供诊断与基准。 */
export const isRustBudgetReady = (): boolean => ready

export const rustBudget = {
  estimateTokens: (text: string): number | undefined => (ready ? rustEstimateTokens(text) : undefined),
}
