/**
 * 自定义 API 地址的规范化与校验。
 *
 * 客户端自己会拼接 `/anthropic/v1`、`/models`、`/v1/tools` 这些路径，所以这里**只保留 origin**：
 * 用户粘贴 `https://example.com/v1` 也会被收成 `https://example.com`，避免出现 `/v1/anthropic/v1`
 * 这种拼接错误。
 *
 * 纯函数，不依赖 DOM，便于单测。
 */

/** 返回规范化后的 origin；空串/非法/非 http(s) 一律返回 null（表示用内置地址）。 */
export const normalizeOrigin = (raw: string | null | undefined): string | null => {
  const value = (raw ?? '').trim()
  if (!value) {
    return null
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null
  }
  // url.origin 会丢掉路径、查询、hash 以及内嵌的账号密码
  return url.origin
}

/** 判断是否真的自定义过（和内置地址相同视作未自定义）。 */
export const isCustomOrigin = (origin: string | null, builtIn: string): boolean =>
  origin !== null && origin !== builtIn
