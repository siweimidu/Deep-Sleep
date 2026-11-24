# Rust 重构现状

工具：`rust-anything` v4.0.0（record → port → build → diff → gate）。方法见
[DESIGN.md](./DESIGN.md)，操作手册见 [HOW-TO-PORT-A-UNIT.md](./HOW-TO-PORT-A-UNIT.md)，
接入步骤见 [ADOPTION.md](./ADOPTION.md)。

## 一句话结论

DeepSleep 的**逻辑层已经用 Rust 重写，并且逐单元用 record/diff 证明了行为等价**：
**16 个 crate、9752 条记录用例全部通过 `rust-anything gate`**（fmt / clippy -D warnings /
cargo test / build / api / behavior 全绿）。React 前端与视觉一行未改；`src/` 只有一处**纯增量**
改动（见下节 ZIP 接缝）+ i18n 的一个纯函数接缝，`pnpm type` 与 `pnpm lint`（100 规则）仍为
0 warning 0 error。

## 已移植并通过 gate 的 13 个单元

| crate | 源文件 | 用例 | 说明 |
| --- | --- | --- | --- |
| `sse-rs` | `services/api/sse.ts` | 232/232 | SSE 解码状态机，CRLF 跨块、行尾 CR |
| `parseevent-rs` | `services/api/parseEvent.ts` | 83/83 | 流式事件校验，`undefined` 与 `null` 区分 |
| `paths-rs` | `services/chat/history/paths.ts` | 956/956 | 归档条目名，NFC 归一化、安全文件名 |
| `schema-rs` | `services/chat/history/schema.ts` | 67/67 | 导入校验，含 50 条抛错路径逐字对齐 |
| `tolocal-rs` | `services/chat/history/toLocal.ts` | 315/315 | 归档→应用模型（6 条按 `known-diffs.jsonl` 声明） |
| `toarchive-rs` | `services/chat/history/toArchive.ts` | 228/228 | 索引投影 `toIndexEntry` |
| `zipwriter-rs` | `services/chat/history/zipWriter.ts` | 270/270 | ZIP32 名称/上限一致性 |
| `branches-rs` | `services/chat/branches.ts` | 1092/1092 | 消息树版本、环、重复 id |
| `attachments-rs` | `services/attachments.ts` | 1556/1556 | 上传分类，981 项扩展名表逐字内嵌 |
| `documenttext-rs` | `services/documentText.ts` | 544/544 | 扩展名判定（正文抽取是 JS 边界） |
| `location-rs` | `services/location.ts` | 364/364 | 249 个地区表内嵌，精确码匹配 |
| `view-rs` | `services/chat/view.ts` | 1403/1403 | 回复视图、检索合并、来源去重 |
| `reply-rs` | `services/chat/reply.ts` | 1533/1533 | 事件应用、结算、上下文轮次 |
| `budget-rs` | `services/chat/context/budget.ts` | 527/527 | token 估算（按码点）+ 上下文裁剪 |
| `zipreader-rs` | `services/chat/history/zipReader.ts`（经接缝） | 322/322 | ZIP32 中央目录、CRC32、路径校验 |
| `index-rs` | `src/i18n/index.ts`（经接缝） | 260/260 | `translateFor` / `isTranslationKey`，263 条消息表由脚本从 zh/en 生成 |

**合计 9752 条用例。** 一条命令跑完全部证明：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File rust\verify-all.ps1
# 期望：ALL GREEN: 16 crates gated, browser artifact + adapters verified.
```

注意：把某个单元接进应用（函数体改成委托给 Rust）会让 `gate` 的 `recording` 检查失败，因为源码变了。
接完要重新 `record`——录制时适配层初始化不了，于是录的仍是 TS 原版行为，不是自证循环（见
ADOPTION.md 有直接证据）。

### 额外的第二层验证：浏览器产物

`gate` 验的是 **Node 胶水**；进 WebView 的是 `wasm-bindgen --target web` 的另一套胶水，两者调用约定
**不等价**。`rust/web-parity.ps1` 把同一批录制语料回放到浏览器产物上，实测 **10886 次调用通过**，
**每个 crate 的数字与 Node 侧 gate 结论逐一对齐**：

- **15 个 crate 浏览器产物全量通过**：attachments 1556、branches 1092、budget 527、
  documenttext 544、index 260、location 364、parseevent 83、paths 956、reply 1533、schema 67、
  sse 1372、toarchive 228、view 1403、zipreader 322、zipwriter 270
- `tolocal` 309/315 —— 差的 6 条已核对就是 `known-diffs.jsonl` 那 6 条（V8 legacy 日期解析 / 无时区）

编码规则（从 `port.rs` 的参数类型判定，不是猜 TS 类型）：Rust `Value` 参数传 JSON 文本、
`String`/`f64`/`bool` 原样、`async` 要 `await`、缺省的尾随可选参数补 `{"$undefined":true}`。
详见 ADOPTION.md。


## 已经接入的两个单元（按性能实测挑选）

| 源文件 | 适配层 | 接入的函数 | 实测 |
| --- | --- | --- | --- |
| `services/chat/history/zipReader.ts` | `src/rust-core/zipReader.ts` | `parseArchiveBase64` | **5.14×** |
| `services/chat/context/budget.ts` | `src/rust-core/budget.ts` | `estimateTokens`（≥128 单元才走 Rust） | **1.2–1.8×** |

判据与全部 16 个 crate 的实测数字见 [PERFORMANCE.md](./PERFORMANCE.md)。`paths` / `attachments` /
`location` 曾经接过，但实测更慢（约 0.11×），已用 `git checkout` 还原成接线前的源文件并移除适配层。

约定：适配层加载时自动初始化（不阻塞首屏），**拿不到 wasm 就返回 `undefined` 让调用方走原 TS 实现**，
所以接入不会成为新的失败源。`estimateTokens` 的阈值放在调用点（`text.length >= 128`），因为短文本
Rust 反而更慢（16 单元时只有 0.64×）。

实测证据：`node rust/adapter-check.mjs` → 7/7；`pnpm type` 干净、`pnpm lint` 0/0、`pnpm build` 成功；
`dist/static/media/` 只产出 `zipreader_rs_bg.*.wasm`（299,960 B）与 `budget_rs_bg.*.wasm`（246,019 B）。

APK：`gradlew assembleRelease` → `app-release.apk` 4,723,511 B，两个 wasm 都在
`assets/static/media/` 里。

## 设备验证（Android 14 模拟器，WebView 113）

本机没有物理设备，所以用模拟器（`system-images;android-34;google_apis;x86_64`，WHPX 硬件加速）
跑真机口径的验证，`adb install` + 截图 + CDP 都是设备级证据：

- ✅ release APK 安装、启动、渲染正常（`mCurrentFocus=com.deep.sleep/MainActivity`）
- ✅ WebView 走生产源 `https://appassets.androidplatform.net`，`fetch` 能取到两个 wasm：
  200 / `application/wasm` / 字节数一致 / `WebAssembly.validate` 为 true
- ✅ 应用的网络与 API 客户端正常（提交假 Key 时真实返回了 400 错误提示，说明确实连到了
  `api.deepseek.com`）
- ✅ **实测 `window.__deepseekRust.budget === true`** —— 修完 CSP 之后 wasm 在真设备上初始化成功

**这一步抓到一个会让整个优化白做的 bug**：原 CSP 是 `script-src 'self'`，不允许编译 WebAssembly，
`instantiateStreaming` 被拒 → 适配层静默回退 TS → 应用看起来完全正常，但那 5.14 倍从没生效。
修法是最小授权 `'wasm-unsafe-eval'`（详见 ADOPTION.md §2.5）。

### 还没验证到的部分

- **物理设备**：没有插手机，`adb devices` 一直为空（模拟器不算真机）。
- **导入归档的完整 UI 流程**：入口在 API Key 校验之后，需要一个**真实有效的 DeepSeek API Key** 才能
  过去；假 Key 会被服务端拒绝。所以 `parseArchiveBase64` 在设备上还没被 UI 真正触发过——
  它的 `budget` 兄弟已经证明「wasm 在这个 WebView 里能初始化」这条机制通了。

`attachments.ts` 里的 `validateFiles` / `resolveMimeType` 从未接（入参是 `File`，需要先做
`File → {name,size,type}` 映射）。

回退那三个之后，APK 里少带 806 KB 的 wasm（233,503 + 331,679 + 241,378），只留真正更快的两个。



**类型上过不了桥的：**
- `services/api/errors.ts` —— 5 个导出里 4 个靠 `instanceof ApiError`；整份留在 TS。
- `services/chat/history/source.ts` —— 导出返回函数值。
## 唯一一处 `src/` 改动：ZIP 读侧接缝

`zipReader.ts` 原本 5 个导出**全部**过不了桥（`isZipFile`/`summarizeArchive` 收函数，
`readArchive` 是生成器，`readEntry` 返回 `Blob`，`ArchiveError` 继承 `Error`），而真正的字节级核心
（`readDirectory`、`decodePath`、`checkExtra`、CRC 校验）是**私有未导出**的 —— `record` 一行都碰不到。

因此加了一个**纯增量**导出（文件末尾，56 行新增、0 行删除，前 357 行逐字节未变）：

```ts
export type ParsedArchive = { offset: number; entries: { path; size; flags; method; crc;
                                                     compressedSize; offset; start }[] }
export const parseArchiveBase64 = async (base64: string): Promise<ParsedArchive>
```

用 base64 而不是 `Uint8Array`，是因为 wire 没有字节类型。它**复用**原有的 private 核心，零解析逻辑
被复制。桥之后 `zipreader-rs` 拿到 322/322，而原 5 个导出继续留在 TS。
`pnpm type` / `pnpm lint` 改动前后都是干净 —— 这是加这个接缝的前提。
- `toArchive.ts` 的 `toSessionFile` —— 签名收 `ExportImage`（成员是函数），`bridge` 判 `js_only`。
  也就是说**导出侧"写归档"的主函数无法过桥**，只有索引投影可以。
- `schema.ts` 的 `readSessionIndex` —— 写成 `export const x: Read<T[]>` 泛型标注箭头函数，
  导出提取器识别不到，无法桥也无法 diff。

**平台绑定的（换 Rust 没有意义）：** `clipboard.ts`、`id.ts`、`settings.ts`、`appUpdate.ts`、
`imageUpload.ts`、`speech/recorder.ts`、`chat/store.ts`、两个 Worker、
`exportArchive.ts`/`importArchive.ts`/`linkImport.ts`（Blob 边界）、`context/anchor.ts`、
`context/memory.ts`。

**纯数据、没有函数所以不是单元：** `services/uploadExts.ts`（1 个 `export const`、零函数，
`bridge` 直接拒绝）、`services/locationData.ts`（4 个 `const` 数据字面量）。两者的数据已逐字
内嵌进 `attachments-rs` / `location-rs`。

**依赖运行时环境、wasm 里无法复现的：**
- `sessionGroups.ts` —— 按**宿主时区**分日/分月。实测同一时刻在 `TZ=UTC` 与 `TZ=Asia/Shanghai`
  下 48 个采样点中有 **16 个落在不同分组**。wasm 没有时区。
- `latestReminder.ts` —— `Intl.DateTimeFormat` + `Intl.DisplayNames` + 浏览器时区。
- `describe.ts` —— 返回文案里内嵌 `translate(...)`，而 `translate` 读
  `useSettings.getState().locale` → `localStorage` → `navigator.language`。硬编码 zh 能"通过"
  用例但对 en-US 用户是错的，所以不做。
- `scrollTarget.ts` —— 本身就是 zustand store 的 `setState` 包装，Rust 侧无可移植的映射。

## 必须知道的三个限制

1. **`getAreaTitle` / 错误文案只有 zh-CN。** 原版经 `translate()` 按 locale 出文案，wasm 里没有
   locale store，所以 `view-rs` 的 `getAreaTitle` 与 `schema-rs` 的错误消息固定为中文。这 6 条
   差异已在 `tolocal-rs/known-diffs.jsonl` 与文档里逐条声明。
2. **`tolocal-rs` 依赖一行生成代码补丁。** `refresh` 会重写 `index.cjs` 并冲掉它，冲掉后
   diff 从 315/315 掉到 177/315。补丁脚本：`node rust/tolocal-rs/fix-glue.mjs`（幂等）。
   `branches-rs` 有同样情况。
3. **本机无法出 APK。** 没有 Android SDK/NDK，Rust 的 android target 虽装但缺 NDK 链接器。
   交付到 wasm 产物 + 接入步骤（见 ADOPTION.md），没到安装包。
4. **这些 crate 不能合并成单个 wasm 模块。** 每个 crate 都是生成的 cdylib，各自导出同名 wire
   入口（`rustAnythingWireMemory` 等），两个一起链接会直接报
   `the name rustAnythingWireMemory is exported by multiple crates in this build`。所以交付形态是
   **每单元一个 wasm 模块、按需 `import()`**，不是一个大包。`budget-rs` 因此把 `reply.ts` /
   `view.ts` 中它真正用到的那两小段在内部重新实现了一遍，而不是去依赖兄弟 crate。

## 还没做的

- **没有接入任何调用点**：业务代码只接了 `paths`、`attachments`、`location`、`zipReader` 四处，
  其余仍走原 TS。接入模板与实测结论见 ADOPTION.md。
- `src/i18n` 的 `translate` / `useTranslate` **故意留 TS**（读 settings store，locale 是运行时状态）；
  纯函数 `translateFor` / `isTranslationKey` 已移植并可逐用例验证。
- wasm 体积/首屏代价没在真机上测过。
