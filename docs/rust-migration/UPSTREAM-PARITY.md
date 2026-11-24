# 对齐上游功能：进度与交接

## 最终状态（2026-11-25）

全部条目已完成，或经实测确认本仓库早已具备。最终校验：`pnpm type` 0 error、`pnpm lint` 0/0、
`rust/verify-all.ps1` **16/16 gated, ALL GREEN**、`gradlew assembleDebug` BUILD SUCCESSFUL。

本会话交付（均有提交与验证）：

| 提交 | 内容 | 验证方式 |
| --- | --- | --- |
| `1c1b4dc` | 旧 WebView 兼容层（Chromium 95 下限） | Node + 模拟器 |
| `854d31d` | 原生 SQLite 镜像 + 存储被清恢复 | 端到端：清 IndexedDB → 重启 → 会话恢复 |
| `e26c145` | 回车换行 / 复制 toast / 用户消息字号 / 退出语音回焦 | 构建 + 运行时 |
| `6b1f368` | 回到底部按钮 + 动效 | scrollTop 1426 = max 1425 |
| `2f19b00` | 导入深度合并 | 10 条断言 |
| `1b99fb9` | 自定义 API endpoint（运行时覆盖） | 15 条断言 |
| `b33e04f` | 导入解析下沉 worker | 无 window 环境 + WebView 实例化 |
| `2dfd4f7` | token 估算按码位分档（TS/Rust 对称） | gate 527/527 + parity 10 例 |
| `f1bc892` | 去掉启动 KaTeX 预载 / 估算器内联 | 启动资源 6→2；1.09× |
| `00c49d9` | 重新录制 budget-rs | gate 通过 |
| `3bf9827` | 行内代码基线对齐 | 计算样式 + 截图 |
| `a9f254b` | 公式复制还原 LaTeX | 真实 KaTeX 选区复制 |
| `c7e95c3` | 上下文摘要可见卡片 | 截断 3 行 / 展开 clamp:none |

经实测确认**早已具备**、无需改动的上游项：内容搜索、消息编辑、图片查看器、个人资料编辑、
深色状态栏、会话操作菜单、Office/PDF 提取、APK 隐式 intent、抽屉惯性吞点击、宽屏布局，
以及上下文摘要的生成与注入（`ensureAnchor` / `ensureMemoryBlock`）。
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

小修组（逐项实测后的真实状态）：

| 项 | 状态 |
| --- | --- |
| 行内代码对齐 | ✅ 已修（inline-flex → inline，灰底不再低于基线） |
| 输入区开关溢出 | ✅ 已修（.toggles 横向滚动） |
| 设置字号图标换行 | ✅ 已修（white-space: nowrap） |
| APK 更新隐式 intent | ✅ 本来就是标准写法，误报 |
| 抽屉惯性吞点击 | ✅ **实测不存在**：面板 left:0→快甩→left:-344 关闭，紧接着点输入框 activeElement 仍是 TEXTAREA。判抽屉开合必须看 [data-android-drawer] 的 rect，不能看 DOM 文本（关闭时文本仍在）。CDP 触摸坐标是 **CSS 像素**（视口 412×891），不是设备像素。 |
| 宽屏布局 | ✅ **本来就有**：转横屏后自动切双栏（左导航 344px + 右内容），段落最宽 561px（866px 视口下未拉满）、输入区居中 580px。横屏开键盘时视口会被压到 151px，那是 adjustResize 的正常表现，不是布局 bug。 |

最后：**性能优化轮** → 全部完成后**关闭电脑**（用户明确要求）。
## 在没有真机的情况下怎么做界面验证（重要）

模拟器上可以通过**原生镜像**造出真实会话，从而看到消息列表、公式、代码块的渲染：

1. 
ode scripts/seed-emulator-session.mjs —— 往 SQLite 镜像里写一条 10 条消息的会话
   （**必须**构成 parentId 链并设置 selectedChildId，否则会被当成同一节点的多个版本，界面显示 "1 / 10" 翻页）
2. 用 CDP 清空 IndexedDB 的五个 store（sessions/sessionSummaries/files/sessionsStaging/filesStaging）
3. force-stop + 重启 —— 触发镜像恢复，会话出现在抽屉里
4. 门禁页可以用 DeepSeekAndroid.writeApiKey('sk-emulator-ui-probe') 绕过（只影响 UI，API 调用会失败）

本轮据此**真实验证**并通过：
- 镜像恢复：清空 IndexedDB 后重启，抽屉里出现注入的会话（"存储被清后恢复"端到端成立）
- 回到底部按钮：滚到顶出现（data-visible / opacity 1 / pointer-events auto），点击后 scrollTop 1426 = max 1425
- 公式复制：真实 KaTeX 渲染后复制含公式选区 → 行内公式 $E = mc^2$ 应该和文字在同一基线上。

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
