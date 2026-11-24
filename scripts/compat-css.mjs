// 给 CSS 补上旧 WebView 能懂的降级声明（保留现代写法，新内核仍走精确值）。
//
// 目标下限是 Chromium 95（Android 5/6 的 WebView 上限）：
//   color-mix() 需要 111  -> 前面补一条同 alpha 的中性 rgba 兜底
//   dvh         需要 108  -> 前面补一条等价的 vh
// 其它新语法（:is() 88、inset 87、Object.hasOwn 93）都在 95 以下，不用处理。
//
// usage: node scripts/compat-css.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs'
import { globSync } from 'node:fs'

const check = process.argv.includes('--check')
const files = globSync('src/**/*.css')

const MIX = /color-mix\(in srgb,\s*([^,]+?)\s+(\d+(?:\.\d+)?)%,\s*transparent\s*\)/g

let mixCount = 0
let dvhCount = 0
let touched = 0

for (const file of files) {
  const original = readFileSync(file, 'utf8')
  const lines = original.split('\n')
  const out = []

  for (const line of lines) {
    // dvh：先给一条 vh 的等价声明
    if (line.includes('dvh') && line.includes(':')) {
      out.push(line.replaceAll('dvh', 'vh'))
      dvhCount += 1
    }
    // color-mix：先给一条同 alpha 的中性灰兜底
    if (line.includes('color-mix(')) {
      const fallback = line.replace(MIX, (_m, _color, percent) => {
        const alpha = Math.round((Number(percent) / 100) * 1000) / 1000
        return `rgba(127, 127, 127, ${alpha})`
      })
      if (fallback !== line) {
        out.push(fallback)
        mixCount += 1
      }
    }
    out.push(line)
  }

  const next = out.join('\n')
  if (next !== original) {
    touched += 1
    if (!check) writeFileSync(file, next)
  }
}

const label = check ? '待补' : '已补'
console.log(`${label}: color-mix 降级 ${mixCount} 条, dvh 降级 ${dvhCount} 条, 涉及 ${touched} 个文件`)
