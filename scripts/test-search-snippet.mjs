// 搜索片段：代理对安全、窗口长度、省略号位置。
import { buildSearchSnippet } from '../src/services/chat/searchSnippet.ts'

let failed = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    console.log('  ✓', name)
  } else {
    failed += 1
    console.log('  ✗', name, detail)
  }
}

const plain = buildSearchSnippet('今天天气不错，我们去公园散步吧', '公园')
check('命中就返回片段', plain?.snippet.includes('公园'))
check('短句不加省略号', plain?.snippet.startsWith('…') === false)

const long = `开头${'啊'.repeat(200)}关键词${'呀'.repeat(200)}结尾`
const far = buildSearchSnippet(long, '关键词')
check('远离开头时左侧加省略号', far?.snippet.startsWith('…') === true, far?.snippet.slice(0, 6))
check('右侧也加省略号', far?.snippet.endsWith('…') === true)
check('片段长度受控（不超过 100）', (far?.snippet.length ?? 0) <= 100, String(far?.snippet.length))
check('片段里确实有关键词', far?.snippet.includes('关键词') === true)

// 代理对：在 emoji 中间切开会变成乱码方块
const emoji = `${'🌊'.repeat(60)}关键词`
const cutEmoji = buildSearchSnippet(emoji, '关键词')
const safe =
  cutEmoji !== null &&
  !/[\ud800-\udbff]$/.test(cutEmoji.snippet.replace('…', '')) &&
  !/^[\udc00-\udfff]/.test(cutEmoji.snippet.replace('…', ''))
check('不会把 emoji 切成半个', safe, JSON.stringify(cutEmoji?.snippet.slice(0, 4)))

check('没命中返回 null', buildSearchSnippet('abc', 'zzz') === null)
check('空词返回 null', buildSearchSnippet('abc', '   ') === null)
check('大小写不敏感', buildSearchSnippet('Hello World', 'WORLD') !== null)

// 高亮区间要能对上片段里的位置
const range = buildSearchSnippet('前缀文字关键词后缀', '关键词')
check('高亮区间对齐', range?.snippet.slice(range.start, range.end) === '关键词', `${range?.start}-${range?.end}`)

const flatOk = buildSearchSnippet('换行\n\n很多空白\t\t关键词', '关键词')
check('空白被压平', flatOk?.snippet.includes('\n') === false && flatOk?.snippet.includes('关键词') === true)

console.log(failed === 0 ? '全部通过' : `失败 ${failed} 项`)
process.exit(failed === 0 ? 0 : 1)
