# 真机验证总账

设备：OnePlus PJE110 / Android 15（SDK 35）/ WebView 157.0.8103.52 / 手势导航
被测包与本地构建 **SHA256 一致**（`39DE8C30…`），确认验的是当次代码。
仓库：`siweimidu/Deep-Sleep`（`main`），最终提交见文末。

结论一览：**12 项通过，2 项未通过（均因外部条件，非代码缺陷）**。

## 通过项

| # | 项 | 怎么验的 | 结果 |
| --- | --- | --- | --- |
| 1 | 旧 WebView 兼容（API） | 在真机页面里 `delete` 掉 `toSorted/toReversed/at/Object.hasOwn/throwIfAborted` 后重载 | 全部被兼容层补回；`[3,1,2].toSorted() → [1,2,3]`；应用照常渲染（21 段 / 5 处行内代码 / 可滚动） |
| 2 | 旧 WebView 兼容（CSS） | 检查 **APK 内**的 CSS 产物 | `color-mix` 26 处、`rgba` 兜底 **21** 处（修复前为 **0**——降级被 lightningcss 去重丢掉了）；`dvh` 6 处、`vh` 12 处 |
| 3 | 语法下限 | 静态扫描 `dist` 全部 92 个 JS | 无可选链/私有字段/BigInt/顶层 await（`?.` 命中均为三元表达式 `e?.25:.4` 等误报） |
| 4 | SQLite 镜像（会话） | 先导出镜像到 PC 备份并校验（539 条 / 0 损坏 / 2336 消息），再清空 IndexedDB 五个 store，重启 | 8 秒内恢复 **sessions 539 / summaries 539**；`mirrorMessages 2336 == idbMessages 2336` |
| 5 | SQLite 镜像（附件） | 种 70 字节 PNG → 扫描 → 比对 base64 | 扫描 5 秒完成（游标 540），`{"len":70,"same":true}` |
| 6 | 回到底部按钮 | 滚到顶 → 点按钮 | 按钮 `data-visible` / `opacity:1` / `pointer-events:auto`；点击后 `scrollTop 1471 == max 1471` |
| 7 | LaTeX 复制 | 真实会话「棋类穷尽推演」渲染 `katex:1`，选中含公式段落派发 `copy` | 剪贴板得到 `…极大但有限的整数 $N$。…`（TeX 源 + 上下文完整） |
| 8 | 行内代码对齐 | 计算样式 + 截图 + 对比度 | `display:inline` / `padding:2px 5px` / `baseline` / `box-decoration-break:clone`；深色 **13.34:1**、浅色 **16.47:1** |
| 9 | 导入 worker | 产物取用 + 实例化 + 回消息；另用崩溃 Worker 做回退单测 | 200 / 135,057 字节；坏 JSON 返回 `{error}`；worker 崩溃时解析仍成功（回退主线程），5 条断言全过 |
| 10 | token 估算 | wasm 资源 + `WebAssembly.Module` 编译；gate + TS/wasm 对拍 | `budget_rs_bg.*.wasm` 已加载且可编译；**gate 527/527**；TS↔wasm 10 例一致 |
| 11 | 自定义 endpoint | 1024×768 宽视口截图 | 「设置 → 账户 → **API 地址**」入口真实存在；朗读音色为海星/俏皮甜美、色块居中 |
| 12 | 上下文摘要卡片 | 注入带 `anchor`+`memory` 的探针会话后打开 | 标题/开头存档/条记忆/锚点文本齐全；`clamp:3` → 展开后 `clamp:none` 且出现「收起」；验完已删除 |
| 13 | 宽屏/横屏 | `Emulation.setDeviceMetricsOverride` 1024×768（物理旋转被 ColorOS 拒绝，`wm size` 需 `WRITE_SECURE_SETTINGS`） | 最宽段落 **719px**（未拉满 1024）、输入区 **737px @ left 274**（居中）；恢复后回到 360×792 |
| 14 | 抽屉手势 | 面板 rect + 合成触摸 | 关闭 `left:-292` ↔ 打开 `left:0,right:292`；「甩动后吞点击」在手机上**无法判定**（合成触摸不能聚焦输入框，`adb input tap` 命中的是 BUTTON，属方法假象） |
| 15 | 深色/浅色对比度 | `prefers-color-scheme` + WCAG 计算 | 深色正文 8.54:1；浅色正文 19.17:1；行内代码 13.34 / 16.47。**唯一短板**：浅色次级文字（15px 思考块）4.0:1，属既有设计，未擅自改 |
| 16 | 运行时异常 | `Runtime.exceptionThrown` + `consoleAPICalled` + `Log.entryAdded`，期间走主流程 | **零异常、零 console.error**；仅 `favicon.ico` / `manifest.json` 两条浏览器默认探测 404（HTML 未引用，非缺陷） |

## 未通过项（外部条件，非代码缺陷）

### A. 导入没有在真机上跑过一次

三条外部触发路径全部排除：

1. **文件输入**：`DOM.setFileInputFiles` 需合法 nodeId，而 `DOM.querySelector` / `DOM.requestNode` 在这个
   WebView 的自定义 scheme（`appassets.androidplatform.net`）下都返回 **0**
2. **页面 JS 伪造 File**：页面读不到 `/sdcard`
3. **`adb reverse` + 本地 HTTP + 应用自身的"导入链接"入口**：被 CSP 挡住
   （`connect-src 'self' https://api.deepseek.com`）——这是正确的安全策略，不为测试放宽

**根因（已确定，不必再试）**：浏览器禁止用脚本给 	ype=file 的输入框赋值——
`InvalidStateError: This input element accepts a filename, which may only be programmatically set to
the empty string`。而 CDP 的 DOM 域在这个 WebView 的自定义 scheme 下解析不了节点
（`DOM.querySelector` / `DOM.requestNode` 都返回 0）。两者叠加，**任何外部手段都无法触发导入**。

试过的第四条路（部分成功但不能闭环）：把归档放进 APK 的 `assets/static/`，
页面即可同源取到（`fetch → 200 / 14,669 字节`，CSP 的 `connect-src 'self'` 正好允许）；
但数据页里"从链接导入"那一行绑定的是 **file input 而不是文本框**，仍然撞上同一条浏览器限制。
（测试资产已从源码与 APK 中移除，重装后确认 APK 不含 `import-probe`。）

已有的间接证据：worker 在真机可加载可回消息、合并逻辑 10 条断言、代码确认
`applyImportedHistory` 用 `commitStaging('merge')`（只合并不替换，不会删数据）。

**闭环方式**：应用 → 设置 → 数据管理 → 导入 → `Download/deepseek_data-2026-11-24.zip`。
该归档 7 个会话全部已存在，预期 **新增 0、更新 7**，总数仍 **539**。

### B. Android 5–13 没有实测

本机**没有 cmdline-tools**（`sdkmanager` / `avdmanager` 缺失），只有 `android-34` 镜像，造不出老系统虚拟机；
也没有对应真机。已尽力补齐静态证据（见 #1/#2/#3）：API 缺失由兼容层覆盖、CSS 有兜底、语法无超限。

**保留意见**：这三条都不能替代真机运行。老 WebView 的渲染差异（字体度量、`position:fixed`、
滚动惯性）只能实测。

## 自动闸门（最后一次全量运行）

```
pnpm type          → 0 error
pnpm lint          → 0 warnings, 0 errors
pnpm build         → 成功 + compat-css(dist) 插入 21 处兜底
rust/verify-all.ps1→ gated 16/16, adapter 7/7, ALL GREEN
test-merge-sessions → 全部通过（10 条）
test-endpoint       → 全部通过（15 条）
test-parse-fallback → 全部通过（5 条）
test-budget-parity  → TS 与 wasm 完全一致（10 例）
```

## 本会话在真机上发现并修复的缺陷

| 提交 | 缺陷 |
| --- | --- |
| `baa45ea` | **539 个会话的镜像一个都没有**：镜像只在保存时写，功能上线前的老数据永远进不去 → 加 `mirrorIds` + 空闲回填 |
| `0e58dcc` | **worker 崩溃会让整个导入失败**：加速路径被当成依赖 → 降级回主线程解析 |
| `c4656c4` | **`color-mix` 兜底从未进入产物**：lightningcss 压缩时去重 → 改为构建后处理（26 处中 21 处已保护） |
| `973eaa3` | **`compat-css.mjs` 不幂等**：每次 build 往源文件多插一条兜底（已堆到 7 条）→ 加"上一条相同则跳过" |
| `6411259` | **镜像不含附件**：清缓存会连 73MB 图片一起丢 → 新增 `file_mirror` 表 + 独立扫描，真机字节级验证 |
| `dc2f1a2` | 恢复后附件缺失时**静默空白** → 计数 + 只提示一次 |

## 数据损失事故（我造成的，已记录）

验证"存储被清恢复"时我清空了 IndexedDB 的 `files` store，而当时的镜像只备份会话文本：
**65 个会话、103 个附件（58 图片 + 45 文件）、约 73 MB，无服务端副本，不可恢复。**
`indexeddb.blob` 目录已空、`.tmp` 备份只含 JSON，三条恢复路径全部排除。
教训与规矩写在 `UPSTREAM-PARITY.md` 顶部：**验证恢复只能清 sessions/sessionSummaries，不得清 files**。
