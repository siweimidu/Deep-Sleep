# 对齐上游功能：进度与交接

目标：上游 `LiJiaHua1024/deepseek-app-replica`（v0.9.4）有、本仓库没有的功能与修复，全部**自己实现**
（只参考其行为，不照抄代码）；要求兼容 Android 5–17 全品牌；全部完成后做一轮性能优化；
最后一步才关闭电脑。

## 验证条件（重要）

- **没有物理真机了**。唯一可用的运行环境是模拟器 `emulator-5554`（Android 14 / WebView 113）。
- 模拟器上应用没有 API Key、没有聊天记录，所以**依赖真实会话的界面（消息列表、编辑器）无法可视化验证**，
  只能用「构建 + typecheck + oxlint + Node 单测 + CDP 探针」这套闸门。
- 结论要如实标注：哪些是运行验证过的，哪些只是构建/静态验证。

三道闸门（每次提交前都要过）：

```powershell
pnpm type          # 0 error
pnpm lint          # 0 warnings 0 errors
cd android; gradlew.bat assembleDebug
# 需要跑起来看时：装到 emulator-5554 + CDP 探针
```

## 已完成

| 批次 | 内容 | 提交 |
| --- | --- | --- |
| 1 | **旧 WebView 兼容层**（Chromium 95 下限）：`src/app/webviewCompat.ts` 补 `AbortSignal.throwIfAborted`/`reason`、`inert`、`toSorted`/`toReversed`、`Object.hasOwn`、`at`、`randomUUID`；`scripts/compat-css.mjs` 给 27 条 `color-mix` + 6 条 `dvh` 补降级声明，另 2 条两色混合手写兜底 | `1c1b4dc` |
| 2 | **原生 SQLite 镜像**：`ChatStorage.java`（WAL、单写者、按会话存 JSON）+ `nativeMirror.ts`（800ms 合并写、静音恢复、坏数据跳过）+ `db.ts` 在整表/单会话为空时自动恢复 | `854d31d` |
| 3 | **交互修复**：移动端回车换行、复制回答弹 toast、用户消息字号跟随设置、退出语音模式回焦输入框 | `e26c145` |
| 4 | **回到底部按钮**（仅移动端）：距底 >320px 浮出，强制恢复跟随 + 平滑滚动，动效走项目 token | `6b1f368` |
| 5 | **导入深度合并**：`mergeSessions.ts` 明确合并策略（归档顺序权威、同 id 保留本地对象、标题/时间/根消息/本地派生字段各自规则），`scripts/test-merge-sessions.mjs` 10 条断言 | `2f19b00` |

## 未完成（按建议顺序）

> **更正（2026-11-25）**：早期凭文件名对比上游得出的"缺失清单"有 6 项是**误报**，本仓库已有等价实现，
> 不要重写 —— 核对方式必须是按符号 grep `src/`，不是按文件名对比上游：
>
> | 项 | 本仓库已有 |
> | --- | --- |
> | Office/PDF 文本提取 | `services/documentText.ts`（docx/xlsx/pptx/pdf，含 FlateDecode + Tj/TJ） |
> | 消息编辑 | `components/messages/UserMessage.tsx` 编辑态 |
> | 图片查看器 | `components/files/ImageViewer.tsx` + `imageViewerState.ts` |
> | 个人资料编辑 | `components/settings/AvatarEditor.tsx` |
> | 深色状态栏 | `setDarkBars` / `app/theme.ts` |
> | 会话操作 | 长按菜单：重命名 / 详情 / 置顶 / 多选 / 删除 |
| 内容搜索 | components/search/SessionSearchPage.tsx（按批加载会话 + 标题与正文匹配 + 命中缓存） |
| 正文可选中 | 消息正文未禁用选择；user-select: none 只在小徽章/脚注序号上 |

真正还缺的 6 项，按建议顺序：

1. **内容搜索**：跨会话全文搜索。现有 `SessionSearchPage` 只搜标题与会话内；需要匹配、摘要、高亮与跳转。
1. **上下文摘要**（`contextSummary`）：长会话的可见摘要卡片，配合已有的锚点卡 + 事实账本。
2. ~~自由文本选择 + LaTeX 复制~~ **已完成**（批次 6：`app/latexCopy.ts`）。
4. **高级 API 设置 / 自定义 endpoint**（OpenAI 兼容转发）。
5. **导入走 worker**：导入目前在主线程解压 + 解析，长归档会卡 UI。
6. **token 估算分档**：现在是「宽字符 + 窄字符/3.6」；改为按码位区间分档。
   ⚠ `estimateTokens` 已录制进 Rust 单元，改公式必须同步 `rust/budget-rs` 并重新录制。

另有一组小修（价值低但上游有）：抽屉惯性吞点击、输入区开关溢出可滚动、宽屏布局、
设置字号图标换行、行内代码对齐 + 列表内公式渲染、APK 更新改用标准隐式 intent。

最后：**性能优化轮** → 全部完成后**关闭电脑**（用户明确要求）。
## 已确认的技术事实（不要重新推导）

- 构建 CSS 用 lightningcss，targets 降到 `chrome 66` **并不会**降级 `color-mix`/`dvh`/`toSorted`，
  所以兼容必须显式做（见 `scripts/compat-css.mjs` 与 `webviewCompat.ts`）。
- CSS 嵌套已被展平成 `:is()`，`:` `:is(` 需要 Chrome 88 —— 在 95 下限内，不用处理。
- 抽屉手势有三层（Java `dispatchTouchEvent` / JS touch / JS pointer），任何"页面自己要横滑"的区域
  必须同时给 `data-drawer-gesture-ignore` **并** 调 `blockDrawerSwipe(true/false)`，
  否则 Java 层仍会抢（双指缩放被吞就是这么来的）。
- 密码框在 ColorOS 上会被强制换成系统"安全键盘"，所以 Android 上用 `secretInput()`（遮字文本框）。
- APK 的 dex 会分片，检查新类是否进包要遍历 `classes*.dex`，不能只看 `classes.dex`。
- 模拟器上装包要用 `install`（必要时先 `uninstall`），`install -r` 有时不会真正替换。

## 性能优化候选（最后一轮）

- 首屏 JS：`main.*.js` ≈ 735KB，其中 markdown/KaTeX/mermaid 体积最大，按需拆包收益最高。
- 导入在主线程解压，可搬到 worker（与第 4 项一起做）。
- `planContext` 每轮全量估算，可用上一轮 `inputTokens` 做增量。
- 长列表渲染：消息列表未做虚拟化，长会话滚动是主要卡顿来源。
