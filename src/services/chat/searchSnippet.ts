/**
 * 搜索结果片段：围绕首个命中截一段，并把空白压平。
 * 两个必须处理好的边界：
 *   1. 不能在代理对（emoji、部分生僻字）中间切断，否则会渲染成乱码方块；
 *   2. 命中位置离开头太近时直接从 0 开始截，避免出现"…开头只剩 3 个字"这种碎片。
 */
const MAX_CHARS = 96
const LEAD_CHARS = 10
const DIRECT_START = 14

/** 把切点挪到安全的字素边界：落在代理对后半就往前退一格 */
const cut = (text: string, index: number): number => {
  const at = Math.max(0, Math.min(index, text.length))
  if (at <= 0 || at >= text.length) {
    return at
  }
  const code = text.charCodeAt(at)
  return code >= 0xdc00 && code <= 0xdfff ? at - 1 : at
}

export type SearchSnippet = { snippet: string; start: number; end: number }

/** 没有命中返回 null；命中则返回片段与它在原文里的区间（供高亮用） */
export const buildSearchSnippet = (text: string, term: string): SearchSnippet | null => {
  const needle = term.trim().toLocaleLowerCase()
  if (!needle) {
    return null
  }
  const flat = text.replace(/\s+/g, ' ').trim()
  const hit = flat.toLocaleLowerCase().indexOf(needle)
  if (hit < 0) {
    return null
  }
  const start = hit > DIRECT_START ? cut(flat, Math.max(0, hit - LEAD_CHARS)) : 0
  const end = cut(flat, Math.min(flat.length, start + MAX_CHARS))
  const head = start > 0 ? '…' : ''
  const tail = end < flat.length ? '…' : ''
  return {
    snippet: `${head}${flat.slice(start, end)}${tail}`,
    start: hit - start + head.length,
    end: hit - start + head.length + needle.length,
  }
}
