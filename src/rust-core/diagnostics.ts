/**
 * 诊断开关。
 *
 * 设备验证用的几个钩子（`__deepseekRust` 就绪标志、`__deepseekArchive` 两条解析路径、`__deepseekLoadArchive`
 * 这个按需加载器）只在 **debug 包**里启用：`MainActivity` 只有在 APK 可调试时才给 URL 加上 `?diag=1`。
 *
 * 这样 release 包不向页面暴露任何额外入口，而设备复核照样能做——代价只是复核要用 debug 包。
 *
 * 注意不要把 `window` 的存在当成 `location` 的存在：录制用的 shim 把 `window` 指成 `globalThis`，
 * 那里没有 `location`，直接读 `window.location.search` 会在 `rust-anything record` 时崩掉。
 */
export const diagnosticsEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }
  const scope = window as unknown as { location?: { search?: string } }
  return new URLSearchParams(scope.location?.search ?? '').has('diag')
}
