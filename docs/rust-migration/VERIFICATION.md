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
---

## 你回来只需做两件事

### 1. 点一次导入（30 秒）

```
应用 → 设置 → 数据管理 → 导入 → 选择 Download/deepseek_data-2026-11-24.zip
```

**预期**：提示「新增 0、更新 7」，会话总数仍是 **539**（该归档里 7 个会话全部已存在，走的是合并路径，
不会删任何东西——`applyImportedHistory` 用的是 `commitStaging('merge')`）。

**若结果不符**，把应用里的提示文字告诉我（或截图），我据此定位。

### 2. 决定 Android 5–13 怎么算

本机没有 `cmdline-tools`，只有 `android-34` 镜像，也**没有老设备**，所以这部分我做不到实测。
现有的替代证据是三层的：产物语法在 `chrome 66` 之内（92 个文件静态扫描）、
缺失 API 由 `webviewCompat` 补齐（真机"删掉再重载"验证过）、CSS 有 `color-mix`/`dvh` 兜底（APK 产物内验证过）。

**这三个都不等于真机运行**。老 WebView 上字体度量、`position:fixed`、滚动惯性只能实测。
所以你只有两个选择，请明确说一个：

- **「接受推断」** → 我把这项标记为"以静态证据接受"，并在总账里保留这条保留意见；
- **「我来测」** → 在装有 `cmdline-tools` 的机器上 `sdkmanager "system-images;android-21;default;x86"`
  建 AVD 跑一遍，把结果贴给我。

> 提示：Android 5 的 AOSP 镜像自带 WebView 约 Chromium 37，远低于本项目的 95 下限；
> 那种环境下应用**会白屏**，属于已知不支持范围（真实设备通常已通过 Play 商店更新过 WebView）。
> 要覆盖 Chrome 37 需要把整条工具链降到 ES5 并加一整套 polyfill，那是另一个量级的工程。
---

## 第三方模型 switcher（真机，2026-11-25）

设备 OnePlus PJE110 / Android 15 / WebView 157。装机版本：`a71e3e3` + 本轮修复。

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 厂列表 | 36 条全部渲染，含 Agnes（国际）/（中国） | 页面按钮导出 |
| 选厂商 | 落到 `agnes-cn`，`replica:provider-id` 已写盘 | localStorage |
| 手填模型 | `agnes-chat` 写入 `replica:provider-model`，出现已保存 chip | localStorage + 截图 |
| 拉模型 | 请求到达厂商并返回 401，页面提示「API Key 无效或无权限（401）」 | 页面状态行 |
| 发送通路 | 走 OpenAI 兼容分支（错误来自 Agnes 的 401），不是官方通路 | 对话内容 |
| 错误呈现 | 「API Key 无效或已被删除，请更换后重试」+ 更换 API Key 按钮，无上游 JSON 原文 | `RAW_JSON_IN_CHAT false` |

本轮修掉的三个问题：

1. **上游错误原文被当成回答贴进对话** → 改为抛 `ApiError`（复用官方通路的同一个错误类型），
   401 由 `describeReply` 映射成提示 + 操作按钮。断网也归到 `network`，不再显示 `Failed to fetch`。
2. **预设 id 失效时界面直接显示原始 id**（`agnes` 拆档后残留）→ 初始化时校验，认不出就退回官方。
3. **「首字延迟」实际量的是整条流时长** → 改为量第一个增量到达。

推理模型：`reasoning_content` 现在映射成内部思考块（先于正文块），
`finish_reason: length` 也不再被当成正常结束（映成 `max_tokens`）。
Agnes 上一轮在 `max_tokens: 16` 下正文为空就是这个原因——预算被思考吃掉了。

成功回复（补充验证）：把第三方 Base URL 指向 `https://api.deepseek.com/v1`——该域本身就是
OpenAI 兼容的，而手机里那枚 `sk-2…` 正是 DeepSeek 的 Key（对 Agnes 当然 401），于是走的仍是本轮
这条 OpenAI 分支：

- 短问「只回复两个字：收到」→ 1 秒内出现 `收到`；
- 长问（约 150 字描述雨街）→ 正文长度 0 → 3 → 45 → 145 → 243 → 373，分 6 步长大，2.8 秒完成。
  一次性贴满说明没在流，这里是真流式。

所以「第三方能否成功回复并流式渲染」这条已闭环。Agnes 服务器本身没再复测：手机里没有有效 Key
（上一轮用你提供的 Key 从本机直连是通的，12 个模型 + `收到`），换一枚有效 Key 即可复跑。
测试后状态已复原为 Agnes（中国）+ 其官方地址、未选模型。


### 修掉：切供应商填 Key 会跳回首次引导页（用户报的 bug）

两处原因，互相放大：

1. `ProviderSettings` 的 Key 输入框直接 `useSettings.setState({ apiKey })`，从不走 `setApiKey`
   —— 既没落盘，又让 store 在「清空旧 Key 准备粘贴新 Key」的那一刻变成空串；
2. `App.tsx` 只要 `apiKey` 为空就整屏换成 `ApiKeyScreen`，于是正在编辑的设置页当场消失，
   输入到一半的内容也没了。

修法：Key 改成草稿，失焦 / 回车时用 `setApiKey` 落盘（逐字符写要过 AndroidKeyStore，太慢，
不做逐字符写）；**空草稿不落盘**，否则清空输入框再失焦就把 Key 删了；引导页在设置开着时不弹。

真机验证（同一台机，写入占位 Key 后逐条断言）：

| 断言 | 结果 |
| --- | --- |
| 清空草稿后失焦，Key 仍在 | `KEPT_AFTER_EMPTY_BLUR true` |
| 输入新 Key 后失焦，落进原生存储 | `SAVED_NEW_KEY true` |
| Key 为空但设置开着，不跳引导页 | `providerPage true, chatUi true` |

代价与现状：验证过程中我先把手机里的 DeepSeek Key 清掉了（早期脚本用「点行标题收起编辑区」
来失焦，那时的空草稿还是会落盘），**现在手机里没有 Key**，需要你在引导页重新粘贴一次。

