/**
 * 复制含公式的选区时，把渲染出来的公式还原成 LaTeX 源。
 *
 * KaTeX 渲染出来是一大坨 span（视觉排版 + MathML 两份），直接复制会得到
 * "x = − b ± b 2 − 4 a c 2 a" 这种断行的乱码。KaTeX 在每个公式里都留了
 * `<annotation encoding="application/x-tex">` 保存原始 LaTeX，复制时用它替换整棵公式节点最可靠。
 *
 * 只在"选区里确实有公式"时才接管；普通文本复制保持浏览器原生行为（含换行、缩进），
 * 不去重写纯文本的复制结果。
 */

const SELECTION_TEX = 'annotation[encoding="application/x-tex"]'

const replaceFormulas = (fragment: DocumentFragment, inlineDelimiter = '$'): void => {
  for (const node of fragment.querySelectorAll('.katex')) {
    const tex = node.querySelector(SELECTION_TEX)?.textContent?.trim() ?? ''
    if (!tex) {
      continue
    }
    // 行间公式用 $$…$$，行内用 $…$，方便粘回 markdown
    const display = node.classList.contains('katex-display') || Boolean(node.closest('.katex-display'))
    const wrapped = display ? `$$${tex}$$` : `${inlineDelimiter}${tex}${inlineDelimiter}`
    node.parentNode?.replaceChild(document.createTextNode(wrapped), node)
  }
}

const copyHandler = (event: ClipboardEvent): void => {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return
  }
  const range = selection.getRangeAt(0)
  const fragment = range.cloneContents()
  if (!fragment.querySelector('.katex')) {
    return
  }
  replaceFormulas(fragment)
  const text = fragment.textContent ?? ''
  if (!text.trim()) {
    return
  }
  event.clipboardData?.setData('text/plain', text)
  event.preventDefault()
}

export const installLatexCopy = (): void => {
  if (typeof document === 'undefined') {
    return
  }
  document.addEventListener('copy', copyHandler)
}
