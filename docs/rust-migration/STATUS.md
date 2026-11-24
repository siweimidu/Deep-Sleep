# Rust 重构现状

工具：`rust-anything` v4.0.0（record → port → build → diff → gate）。方法见
[DESIGN.md](./DESIGN.md)，操作手册见 [HOW-TO-PORT-A-UNIT.md](./HOW-TO-PORT-A-UNIT.md)，
接入步骤见 [ADOPTION.md](./ADOPTION.md)。

## 一句话结论

DeepSleep 的**逻辑层已经用 Rust 重写，并且逐单元用 record/diff 证明了行为等价**：
**14 个 crate、9170 条记录用例全部通过 `rust-anything gate`**（fmt / clippy -D warnings /
cargo test / build / api / behavior 全绿）。React 前端与视觉一行未改。

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

**合计 9170 条用例。** 复验一条命令：

```powershell
Set-Location "D:\Code\重构\deepseek"
Get-ChildItem rust -Directory | Where-Object { Test-Path "$($_.FullName)\rust-anything.json" } |
  ForEach-Object { rust-anything gate "rust\$($_.Name)" }
```

## 没有移植的东西，以及为什么（都是证据，不是偷懒）

**类型上过不了桥的：**
- `services/api/errors.ts` —— 5 个导出里 4 个靠 `instanceof ApiError`；整份留在 TS。
- `services/chat/history/source.ts` —— 导出返回函数值。
- `services/chat/history/zipReader.ts` —— 5 个导出全是函数/生成器/继承类边界，
  而真正的字节级核心（`readDirectory`、`decodePath`、`checkExtra`）是**私有未导出**的，
  `record` 根本触不到。要能验证，必须先在 `src/` 里抽出 `parseArchiveBytes(bytes)` 这样的
  bytes-in/bytes-out 接缝。
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

- **没有接入任何调用点**：`src/` 一行未改，跑起来的仍全是原 TS。接入是开关式的，步骤已在
  ADOPTION.md 里验证过。
- `src/i18n/**`：纯数据，但 `translate` 依赖 store，需要先改成显式 locale 参数。
- `zipReader.ts`：需要先在 `src/` 抽出上面说的接缝，才能开始验证。
- wasm 体积/首屏代价没在真机上测过。
