import './app/webviewCompat.js'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { android } from './app/android.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import { diagnosticsEnabled } from './rust-core/diagnostics.js'
import './app/theme.css'
import './app/motion.css'
import './app/global.css'
import './app/android.css'

ensureKatex()
if (android) {
  document.documentElement.dataset.android = ''
  document.documentElement.style.setProperty('--android-status-inset', `${android.statusInset()}px`)
}
setupTheme()

// 诊断入口：设备侧用 CDP 验证归档解析的两条路径（rust/cdp-archive.mjs）。
// 只在 debug 包 + ?diag=1 时挂上；归档模块是按需加载的 chunk，不被调用就什么都不会拉取。
if (diagnosticsEnabled()) {
  const scope = window as unknown as { __deepseekLoadArchive?: () => Promise<unknown> }
  scope.__deepseekLoadArchive = () => import('./services/chat/history/zipReader.js')
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
