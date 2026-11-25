import './app/webviewCompat.js'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { android } from './app/android.js'
import { setupTheme } from './app/theme.js'
import { diagnosticsEnabled } from './rust-core/diagnostics.js'
import { installMirrorFlush } from './services/chat/nativeMirror.js'
import { installLatexCopy } from './app/latexCopy.js'
import './app/theme.css'
import './app/motion.css'
import './app/motion-kit.css'
import './app/global.css'
import './app/android.css'

// 不在启动时预载 KaTeX：MathFormula 自己会在遇到公式时调用 ensureKatex()。
// 启动预载会无条件拉一个 264KB 的块 + 两个附属块，而绝大多数会话根本没有公式。
if (android) {
  document.documentElement.dataset.android = ''
  document.documentElement.style.setProperty('--android-status-inset', `${android.statusInset()}px`)
}
setupTheme()
installMirrorFlush()
installLatexCopy()

// 诊断入口：设备侧用 CDP 验证归档解析的两条路径（rust/cdp-archive.mjs）。
// 只在 debug 包 + ?diag=1 时挂上；归档模块是按需加载的 chunk，不被调用就什么都不会拉取。
if (diagnosticsEnabled()) {
  const scope = window as unknown as { __deepseekLoadArchive?: () => Promise<unknown> }
  scope.__deepseekLoadArchive = () => import('./services/chat/history/zipReader.js')
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
