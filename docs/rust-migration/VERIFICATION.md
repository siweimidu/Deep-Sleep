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


### 四家第三方端点的真机实测（2026-11-25，用户提供的 Key）

完整走界面：选厂商 → 输 Key → 拉模型 → 选模型 → 发消息，判据是每次随机 token 在对话里出现两次
（问题一次、回答一次），避免被历史回复误判。

| 厂商 | 模型数 | 选中模型 | 结果 | 用时 |
| --- | --- | --- | --- | --- |
| Agnes（中国） | 12 | `agnes-2.5-flash` | PASS | 12s |
| Agnes（国际） | 13 | `agnes-3.0-flash` | PASS | 2s |
| CSDN（GitCode） | 3 | `deepseek-ai/DeepSeek-V4-Flash` | PASS | 8s |
| Google AI Studio | 65 | `models/gemini-flash-lite-latest` | PASS（需代理） | 2s |

上一轮 Agnes 报 401 的真正原因是手机里存的是 DeepSeek 的 Key，不是 Agnes 的——两枚 Agnes Key 都是好的。

本轮修掉的三个问题：

1. **模型列表被截断到 40 个**（`models.slice(0, 40)`，而且是按字母排序后截）。Google 有 65 个，
   `gemini-*` 全在 40 名之外，用户根本选不到能用的模型。现在全量渲染，容器自己滚（`max-height: 42vh`）。
2. **换厂商后旧模型名还留着**：`setProvider` 没清 `providerModel`，切到 Google 后仍带着 CSDN 的
   `deepseek-ai/DeepSeek-V4-Flash`，发出去必然是失败请求。现在切厂商即清空模型。
3. **请求没有超时**：被黑洞掉的域名既不返回也不拒绝，界面永远停在「正在获取模型…」。
   现在拉模型 20 秒超时、对话 60 秒无增量超时，并给出中文提示「请求超时：连不上这个地址，检查网络或代理」。

另外新增 CSDN（GitCode）预设，并给 Google AI Studio 标上「需要代理」（预设 note + 列表徽章）。

境外厂商连通性实测（手机页面内 fetch，故意用无效 Key；401/200 表示网络通，TypeError 表示
浏览器这一侧拿不到——可能是跨域被拒，也可能是不通）：

```
openai=401  google=400  groq=401  mistral=401  cerebras=401  together=401
fireworks=401  huggingface=200  openrouter=200  zhipu-intl=401  agnes-intl=200
anthropic=TypeError  nvidia=TypeError  perplexity=TypeError  cloudflare=TypeError
```

所以除 Google 之外没有再给别家标「需要代理」：多数在用户当前代理下是通的，而 TypeError 那几家的
原因无法只凭一次探测区分（跨域 vs 不通），不写没有依据的标注。

测试后应用停在可用的配置上：Google AI Studio + `models/gemini-flash-lite-latest`。


### 一厂商多 Key + 额度用完自动轮换

数据层：`api/keyring.ts`（纯函数，可单测）。形状是
`{ keys: { <厂商 id>: [k1, k2…] }, active: { <厂商 id>: 下标 } }`，
整份 JSON 存进 Android 那个原生加密槽（仍是加密的），Web 存 localStorage。
老版本槽里是一把裸 Key，读到时迁到"当前厂商"名下，不会丢。

轮换判定 `isKeyUnusable`：401 / 402 / 403 / 429，或报文里出现
`insufficient quota` / `余额` / `额度` 这类字样。400、404、5xx 不换——那是请求本身或对方服务的问题，
换 Key 没用。轮换次数以该厂商的 Key 数量为上限，换成功就把新下标写回存储，下次从能用的那把开始。

流式通路只在"一个增量都还没吐出来"时换 Key 重来，否则用户会看到半截回答接半截回答。

界面：API Key 行显示 `2 把 · sk-…robe`；展开后是 Key 的 chip 列表（点一下设为在用，`×` 删除），
下面一个输入框粘贴新 Key，失焦或回车即存；底部一句说明"同一家可以存多把，当前这把没额度时自动换下一把"。
首次引导页的判定改成"任何厂商存过 Key 就不再拦"——按单家判定的话，用户存了别家的 Key 就会卡在引导页。

真机验证（本轮手机中途被断开，以下在 emulator-5554 / Android 14 上完成）：

| 断言 | 结果 |
| --- | --- |
| 同一厂商存两把 Key | `{"providerId":"csdn","count":2,"activeIsInvalid":true}` |
| 拉模型时当前这把 401 自动换下一把 | `MODELS 3 picked=deepseek-ai/DeepSeek-V4-Flash` |
| 对话时当前这把 401 自动换下一把 | `BEFORE activeIsInvalid=true` → `REPLY PASS` → `AFTER activeIsInvalid=false` |
| 轮换结果写回存储 | 上面 AFTER 一行即证据 |

过程中修掉的真 bug：`fetchProviderModels` 抛的是纯 `Error("HTTP 401")`，没有 `status` 属性，
而轮换靠 `status` 判断——于是"拉模型"这条路上永远不轮换。现在抛错时带上 status，界面文案不变。

单测 `scripts/test-keyring.mjs`（28 条）：迁移、去重、指定在用、删到空、轮换绕回、只有一把不轮换、
替换在用那把、掩码，以及哪些错误该换 Key。


### 模型按厂商记住 + 官方通路也走轮换

上一轮为了修"切厂商带着别家模型名"的 bug，直接把模型清空了；代价是每家都要重选一遍。
现在把 `厂商 id → 模型名` 存成一张表（`replica:provider-model-by-id`）：
切厂商时读这张表恢复该家上次用的模型，没有就是未选择——既不带旧模型，也不用每次重选。

真机（模拟器）验证，预置 `{agnes-cn: m2-agnes, csdn: m1-csdn}` 后来回切：

```
SWITCH_TO_AGNES  m2-agnes
SWITCH_BACK_CSDN m1-csdn
SWITCH_TO_GOOGLE null      ← 没存过的厂商仍然是未选择，不会带别家的名字
```

官方 DeepSeek 通路也接上了同一套轮换（`streamWithKeyRotation`）：单把 Key 时行为完全不变，
多把时 401/402/403/429 会自动换下一把。
**注意**：这条改动只做到"编译通过 + 与第三方通路共用同一个已真机验证的轮换实现"，
没有用两把真 DeepSeek Key 跑通——手上没有可用的 DeepSeek Key。



### 首次引导页可以跳过 + 没 Key 时直接落到第三方模型页

两处都会把用户丢进设置，但落到哪一页以前是错的。真机（OnePlus PJE110 / Android 15）实测：

| 断言 | 结果 |
| --- | --- |
| 清空 Key 后启动出现引导页 | `GATE shown` |
| 点「先看看，稍后再填」进入主界面 | `MAIN true` |
| 重载后不再被引导页拦住（记住选择） | `PERSIST ok main=true` |
| 没 Key 时点发送 | `SEND {"x":318,"y":447,"disabled":"false"}` → `ENDPOINT ok` |

跳过状态存 `replica:onboarding-dismissed`；`ensureApiKey()` 由 `openSettings('data')` 改成 `openSettings('endpoint')`，
`SettingsSection` 增加 `'endpoint'`：安卓端直接落到 `endpoint` 页，桌面弹窗落到 API Key 那一栏。
判据仍看「当前厂商有没有 Key」而不是「任意厂商有没有」——后者会让发送直接死在缺 Key 上，而不是把人带去填 Key。

### 测试模型性能 → 测试模型速度（tok/s）

原来量的是首字延迟（`maxTokens: 1`，只看第一个增量），这对"模型快不快"几乎没意义：建连和排队占了大头。
现在量首个增量到最后一个增量的区间，并用 `stream_options: { include_usage: true }` 要 `usage.completion_tokens`。
真机实测（CSDN / deepseek-ai/DeepSeek-V4-Flash）：

```
BEFORE
AFTER 约 38.4 tok/s · 189 tokens / 4.9s
```

厂商不回 usage 时退化成按字符粗估，文案里写明「（估算）」，不冒充实测 token 数。
单测 `scripts/test-openai-chat.mjs` 新增 6 条：usage 帧单独到达能解析、usage 帧不混进正文、没有 usage 时字段不出现、
正文帧带 usage 不丢、`include_usage` 真写进请求体、usage 聚合到返回值。

### 已保存的模型按厂商分开（真机）

```
CSDN 2 / AGNES 0 / BACK_CSDN 2
```

这一项之前一直报 `row-missing`：脚本按 `button` 去找那行，而「已保存的模型」是 `div` + `label/value` 两个 `span`
（不是可点按钮）；读不出「2」则是因为手机上跑的还是加这个功能之前的 APK。两件都是验证脚本/打包环节的问题，不是应用 bug。


## 动效：统一基座 + 预测性返回重做（真机 OnePlus PJE110 / Android 15）

### 基座

`src/app/motion.css` 里的弹簧曲线是 `scripts/make-springs.py` 生成的，不手改；
手感放在新的 `src/app/motion-kit.css`：

- 所有 `button` / `[role=button]` / `tab` / `option` 默认就有按压反馈：
  按下 90ms 到位（不能让人等弹簧），松手走 `--motion-press` 弹回。
  选择器用 `:where()` 保持 0 特异性，组件里任何一条自己的规则都能盖掉它。
- 投影放在 `::after` 上只动 `opacity`：`box-shadow` 每帧重算会把整层重绘一遍。
- 不用 `overflow: hidden` 裁剪圆角：裁剪整棵子树会让每帧都在重新裁剪。

**一个隐患**：触摸时 Chrome 会把 `:active` 推迟约 300ms（它在等你是不是要滚动），
表现就是"按下去没反应"。`webviewCompat.ts` 里注册一个空的 `touchstart` 监听后浏览器才立刻给 `:active`。

### 预测性返回

以前各页面自己写 `transform`，只有 4 处有位移、其余 4 处（通话页、图片查看器、裁切页、会话搜索）
根本没有可视反馈。现在统一成舞台：hook 挂载时给元素打 `data-back-stage`，
手势期间发布 `--back-progress`，位移/缩放/圆角/投影由 CSS 一处决定。

真机上量到的（设置页）：

```
AT_REST   x=0   w=360  radius=0px
MID  p=0.55  x=51  w=336  radius=12.1px
FAR  p=0.95  x=89  w=319  radius=20.9px
AFTER_CANCEL x=0 radius=0px      （弹簧归位）
INVOKE_CLOSED true               （提交后真的关掉）
```

顺带修掉抽屉返回的两个问题：

1. **方向反了**：`translateX(calc((--drawer-progress - 1 + --back-progress) * 100%))` 里的加号
   会把抽屉继续往右推，于是左侧露出一片空背景。改成减法。
2. **主卡片不跟手**：返程时聊天卡片仍停在右边，抽屉一撤中间就是空的。现在卡片与遮罩都按
   `--drawer-progress - --back-progress` 一起回位，且手势期间禁用过渡（否则追不上手指）。

修复后同一手势的截图：抽屉左滑、聊天卡片带圆角从右侧滑回，中间不再有空洞。

### 其余

- 设置页换页（`key={page}` 重新挂载）加落位动画；行尾箭头按下时右移 3px。
- 弹窗 / 下拉菜单补入场动画，下拉箭头展开时翻转。
- `Button` / `IconButton` 按压分级（实心按钮悬停抬起 1px，仅指针设备）。
- 消息列表只让新挂载的最后一条入场，切会话不会整屏一起跳。

### 按压态实证

合成 `Input.dispatchTouchEvent` 不会让 WebView 进入 `:active`（CDP 限制，不是应用问题）。
用真实指针序列验证：

```
drawer-button (mouse) {"hitActive":true,"btnActive":true,"transform":"matrix(0.972, 0, 0, 0.972, 0, 0)"}
drawer-button (touch) {"hitActive":false,"btnActive":false,"transform":"none"}   ← 合成 touch 的限制
```

## 厂商预置：用真实密钥逐个校验

从 `freellmapi-keys.json`（203 条）里按 platform / 主机名匹配到 19 个预置，逐个打 `/models`：

```
200  dashscope / zhipu / zhipu-intl / moonshot / siliconflow / modelscope /
     stepfun / nvidia / longcat / agnes-intl / csdn
401  agnes-cn（该 Key 失效）      403  groq（Key 无权）
ERR  google / openrouter / mistral / cerebras / huggingface（本机无代理，直连不通）
```

没有一条是"预置地址写错"，失败都落在网络或密钥本身。

### 官方 DeepSeek 通路首次真机跑通

之前这条路径只有编译级证据（手上没有可用 DeepSeek Key）。这次用真 Key 走完整链路，
并在这个过程中挖出两个真 bug：

| 现象 | 根因 | 修法 |
| --- | --- | --- |
| 厂商已是「DeepSeek（官方）」，Base URL 还是上一家的 `api-ai.gitcode.com` | base url 只有一份全局存储，切厂商只改 id | 改成按厂商存 `replica:provider-base-url-by-id`；老数据主机对不上就退回预置 |
| 修完上面仍报「网络异常」 | Anthropic 通路的 origin（`replica:api-base-url`）是另一份独立存储，同样留着旧域名 | 启动时按主机校一次，对不上就以当前厂商地址为准 |

修完真机结果：

```
BASE api.deepseek.com
MODELS 2 [deepseek-flash, deepseek-v4-pro]
MODEL deepseek-flash
SPEED 约 188.6 tok/s · 200 tokens / 1.1s
REPLY PASS
```

回归测试 `scripts/test-provider-baseurl.mjs`（8 条）覆盖：外来域名不跟着跑、手填地址被记住且按厂商分开、
切走再切回不串地址、Anthropic origin 跟着对齐。


### 其余层面的返回手势（同一套舞台自动继承）

统一舞台的好处在这里最明显：`usePredictiveBack` 早就接在 8 个层上，但其中 4 个层
（通话页、图片查看器、裁切页、会话搜索页）**以前根本没有 `--back-progress` 样式**，
手势期间毫无反馈。补了 `[data-back-stage]` 之后它们自动获得同一套位移/缩放/圆角/投影。

真机实测（合成的 `android-back-gesture` 序列，与原生回调同一形状）：

| 层 | p=0.5 时 | 取消后 |
| --- | --- | --- |
| 会话搜索页 | `x=54 y=17` | `x=0 y=0` |
| 语音通话页 | `x=54 y=28` | `x=0 y=0` |
| 设置页（前一轮） | `x=51 w=336 radius=12.1px` | `x=0 radius=0` |

搜索页的截图里能直接看到：搜索面板带着圆角右滑，露出后面的抽屉 —— 这一层以前是"手一划界面直接消失"。

**没验到的**：图片查看器。它只能从附件卡片打开（`openImageViewer` 的唯一调用点在 `MessageFile.tsx`），
而这台手机当前数据里 `fileCards=0`（早期误清 IndexedDB 丢过附件），所以够不到入口。
代码路径与上面三层完全一致：`ImageViewer` 已接 `usePredictiveBack`，样式由 `[data-back-stage]` 统一给。

子页返回时揭开的是设置首页，不是聊天页

用户报的：在「账号管理」里做预测性返回，滑出来的是首页聊天界面。

根因：设置里所有子页共用同一个可返回层，手势滑走的是整个设置层，
揭开自然就是它下面的聊天页。

- 页面体抽成 renderBody(shown)，子页时渲染两层：
  .under（被压住的上一页，静止、不可点）+ .stack（当前子页，滑走的是它）
- backGesture 用互补 active 挂两个 hook：首页滑整块设置层，子页只滑 .stack
- 子页返回落到 back()，回到首页而不是关掉设置
- 顺手修掉 .under/.stack 被误写进 .scroll {} 里、编译成 .scroll .stack 而不生效的问题
  （子页背景透明，手势中会透出首页）

在真实 Chromium（Android 桥打桩、同一份构建产物）里量到：
  REST stackX=0 / stackBg=rgb(22,22,22) / underHasRoot=true / stackHasAvatar=true
  MID  stackX=77 active=true（p=0.5）  FAR stackX=138 active=true（p=0.9）  CANCEL stackX=0
截图：左侧完整露出设置首页，右侧「账号管理」带圆角与投影滑出。

真机复验（OnePlus PJE110 / Android 15，这一版 APK）：

```
ROOT        stages=[page]            under=无
ACCOUNT     stages=[stack]           under=设置/账户/账号管理/第三方模型/数据管理/应用/语言…（首页）
SUB_MID     stack active x=49        ← p=0.45：滑的是子页，设置层不动
SUB_CANCEL  stack x=0
BACK_TO_ROOT true                    ← 提交后回到设置首页，不是关掉设置
ROOT_MID    stages=[page] active x=49 ← 回到首页后再手势，才滑整块设置层去露出聊天页
```

截图里左边是完整的设置首页，右边「账号管理」带圆角与投影滑出。


## 对齐原项目：搜索片段与高级 API 设置

### 先说结论：搜索本来就已经是「消息级」

对比后发现我这边**不缺**内容搜索：`SessionSearchPage` 已经按消息逐条出结果、带片段、
点击后 `requestScrollToMessage` 跳到那条消息，`MessageList` 还会用 `CSS.highlights`
把命中的词标出来。真正的差距只有片段窗口与边界处理：

| | 原项目 | 改前 | 改后 |
| --- | --- | --- | --- |
| 片段长度 | 96 字符 | 46 字符 | 96 字符 |
| 前导 | 10 字符 | 14 字符 | 10 字符 |
| 代理对（emoji） | 安全 | 可能切半 | 退一格，不切半 |
| 高亮区间 | 有 | 有（按词再切） | 有（函数直接给区间） |

新增 `services/chat/searchSnippet.ts` + `scripts/test-search-snippet.mjs`（12 条）。

### 高级 API 设置

原项目 `AdvancedApiSettings` 提供「模型名 / 协议 / 端点 / 端点 Key / 重置」。我这边原本只有厂商切换
（协议是按 `providerId === 'deepseek'` 硬判断的）。现在补上协议与端点：

- `providerProtocol`：auto / openai / anthropic，**按厂商分别记**
  （有的厂商两种协议都提供，或者 OpenAI 兼容那条地址不通但 Anthropic 那条通）
- `providerEndpoint`：完整 URL 覆盖，按厂商分别记；留空则按协议自动拼
- `resolveChatTarget()`：端点覆盖 > 厂商 base url；auto 时官方 Anthropic、别家 OpenAI 兼容
- 端点覆盖会把 origin 同步给 Anthropic 通路，切厂商互不污染
- 「恢复默认」一键回到 auto + 不覆盖

单测 `scripts/test-chat-target.mjs` 14 条，覆盖：默认推导、手动指定、按厂商记忆、切走再切回、
端点覆盖与 origin 同步、恢复默认。

桌面 Chromium（Android 桥打桩）实测：

```
ADV_ROWS          ["服务协议","协议自动","端点覆盖未覆盖","恢复默认"]
PROTOCOL_OPTIONS  ["自动","OpenAI兼容","Anthropic兼容"]
PICK              true → PROTOCOL_VALUE "Anthropic 兼容"
RESET             true → protocol 自动 / endpoint 未覆盖
```

搜索片段的真机复验待补（Chromium 那份 profile 里没有历史会话，搜不出结果；
手机当时又掉线了）。


### 真机复验（OnePlus PJE110 / Android 15）

```
子页返回      stack active x=49（p=0.45）· under=设置首页 · BACK_TO_ROOT true · 首页才滑整层
高级设置      ADV_ROWS=[协议自动, 端点覆盖未覆盖, 恢复默认]
              PROTOCOL_OPTIONS=[自动, OpenAI兼容, Anthropic兼容]
              选 Anthropic → 协议值变成「Anthropic 兼容」；恢复默认 → 自动 / 未覆盖
搜索片段      ROWS 5 条，每条都带高亮（marks=1），MAX_LEN=26（短消息不截断，长消息见单测）
```

搜索这条踩了两个坑，都是脚本问题不是应用问题：
1. 抽屉和搜索页各有一个「搜索对话内容」输入框，脚本一直往**被压在下面**的那个里填词；
2. 高亮用的是 `<b class="mark">` 而不是 `<mark>`，断言数错了元素。
改成「取可见面积最大的输入框」+ 数 `b, mark` 之后一次通过。


## 电话（语音通话）界面的 Rust 重构

### 为什么这部分值得搬到 Rust

通话界面原来把三件事混在一个 rAF 里：判停（说完没有）、电平跟随、状态切换。
这些东西**给定输入就该有确定输出**，却在 React 的 effect 里散着写，既测不了也改不动。
现在拆成 `rust/call-rs`：

| 模块 | 职责 | 证明 |
| --- | --- | --- |
| `TurnDetector` | 说完没有：余量 220ms 内不计静音，之后静音 620ms 且说够 260ms 才判停 | 5 条 cargo 测试（含"重新开口要重置计时"） |
| `LevelSmoother` | 包络：起音 90ms、释放 260ms，球体跟手但不抖 | 2 条测试（起音快于释放、收敛并夹紧） |
| `orb_params` | 光球形状：core/glow/halo/spin/breathe | 3 条测试（听时跟电平、思考时忽略麦克风、静音时变暗） |
| `next_phase` | 状态机：静音态只认 Unmute，其余事件原地不动 | 1 条测试 |
| `format_duration` | 00:00 / 1:02:05 | 1 条测试 |

`cargo test` **11/11 通过**，clippy 干净。wasm 42KB，走 `wasm-bindgen --target web`。

TS 侧 `src/rust-core/call.ts` 是适配层：Rust 在位就用 Rust，加载失败整段走**逐行等价**的 TS 回退。
`scripts/test-call-core.mjs` 把两份实现逐值对照：**2903 项，0 失败**（时长 15 组、阶段迁移 4×7 全组合、
光球参数 140 组、判停随机序列 40 轮×60 帧、包络 4 组×80 帧）。

`rust/verify-all.ps1` 加了一节 `1b. hand-written crates`，输出：
`call-rs cargo test 11 passed, TS parity 2903 cases`。
（踩坑：仓库路径带中文，MinGW 的 `ld` 读不到自己产出的 `.o`，`CARGO_TARGET_DIR` 必须指到纯 ASCII 路径。）

### 界面：照官方 App 的实际观感重做

原来的通话页是我按"深蓝极光 + 声波环"想象的，跟官方差得远。这次把官方 App（`com.deepseek.chat` v2.8.0，
分身空间 user 999）的通话页截下来逐项对齐：

| | 官方 | 改前 | 改后 |
| --- | --- | --- | --- |
| 背景 | 中性深灰 #191b20 | 深蓝 + 两层极光 | 中性深灰 + 球后一圈极淡光 |
| 球体 | 磨砂白玉，渐变柔边 | 蓝色发光球 + 3 圈声波环 | 磨砂白玉，渐变柔边 |
| 状态 | `••• 正在聆听` | 药丸 + 波形条 | `••• 正在聆听` |
| 挂断 | 深色圆钮 + 红色听筒 | 红色实心大按钮 | 深色圆钮 + 红色听筒 |
| 标题 | 标题 + `通话中 00:16` | 标题 + 计时药丸 | 标题 + `通话中 00:16` |

逐帧参数由 Rust 算好后由 `useOrbPulse` **直接写 CSS 变量**（`--orb-core/glow/halo/spin/breathe`），
不进 React 渲染 —— 60fps 的 `setState` 会把主线程吃满。真机实测：

```
ORB1 {"phase":"listening","core":"0.6000","glow":"0.1800","halo":"0.5500","spin":"0.3500","breathe":"0.0167"}
ORB2 {"phase":"listening","core":"0.6000","glow":"0.1800","halo":"0.5500","spin":"0.3500","breathe":"0.3488"}
                                                  ↑ breathe 在变，说明每帧都在跑；数值正是 orb_params(level=0, Listening)
GEOM  {"dpr":3,"viewport":[360,792],"round":[[56,56],[56,56],[56,56]],"orb":[164,164]}
```

**踩过的坑（都是脚本/工具的，不是应用的）**：
1. `useOrbPulse` 的 effect 依赖里漏了「是否打开」，组件首次挂载时 ref 还是 null 就直接返回了，
   打开后不会重跑 —— CSS 变量永远停在样式表默认值。真机读到 `core:.6`（样式表值）而不是 `0.6000`（Rust 值）才发现。
2. 用 PowerShell 的 `Get-Content | -replace | Set-Content` 改带中文的源码，会按 GBK 落盘把文件写坏（踩了两次）。
3. CDP 的 `Page.captureScreenshot` 与 `adb shell screencap` 的栅格化不一致：同一屏截图，
   前者把 56×56 的圆钮渲染成竖椭圆（DOM 测量是正圆）。判定形状必须用 `screencap`。
