# 重构执行计划

判定依据见 [DESIGN.md](./DESIGN.md)，操作手册见 [HOW-TO-PORT-A-UNIT.md](./HOW-TO-PORT-A-UNIT.md)。
每个单元的完成条件：`diff` 全绿 + `gate` 通过。

## 已完成并通过 gate

| 单元 | crate | 行数 | 用例 |
| --- | --- | --- | --- |
| `services/api/sse.ts`（ServerSentEventDecoder） | `sse-rs` | 136 | 232/232 |
| `services/api/parseEvent.ts`（readMessageEvent） | `parseevent-rs` | 231 | 83/83 |
| `services/chat/history/paths.ts` | `paths-rs` | 24 | 956/956 |
| `services/chat/history/schema.ts`（checkManifest, readSessionFile） | `schema-rs` | 263 | 67/67 |
| `services/chat/history/toLocal.ts`（toLocalSession） | `tolocal-rs` | 318 | 315/315（6 条按 `known-diffs.jsonl` 声明） |
| `services/chat/history/toArchive.ts`（toIndexEntry） | `toarchive-rs` | 257 | 228/228 |
| `services/attachments.ts`（8 个上传分类函数 + 扩展名表） | `attachments-rs` | 214 | 1556/1556 |

合计 **~1440 行 TS 逻辑**已被 Rust 取代，**3437 条**记录用例全部通过。

## 待做

| 单元 | 行数 | 备注 |
| --- | --- | --- |
| `services/chat/history/zipReader.ts` / `zipWriter.ts` | 326 / 109 | 压缩解压内核可移植，`Blob` 层留 TS |
| `services/chat/branches.ts` | 110 | 纯逻辑 |
| `services/chat/{sessionGroups,describe,latestReminder,scrollTarget}.ts` | 118 | 小单元，可合波 |
| `services/documentText.ts` | 119 | 先确认有无 DOM |
| `services/locationData.ts` | 448 | 数据表 + 查询 |
| `src/i18n/**` | 574 | 纯数据；`translate` 依赖 store，需改成显式 locale 参数 |
| `services/chat/context/budget.ts` | 129 | ⏸ 阻塞：`planContext` 依赖 `view.ts`(360) + `reply.ts`(310) |
| 合并为单一 `deepseek-core` wasm crate + TS 适配层 + 浏览器烟测 | — | 见下 |

## 明确留在 TS（平台绑定或过不了桥，不是未完成项）

- **平台 API**：`clipboard.ts`、`id.ts`（crypto/Math.random）、`settings.ts`（localStorage）、
  `appUpdate.ts`（fetch + window 事件）、`imageUpload.ts`（canvas）、`speech/recorder.ts`
  （getUserMedia）、`chat/store.ts`、`markdown/parseWorker.ts`、`history/inflateWorker.ts`、
  `exportArchive.ts` / `importArchive.ts` / `linkImport.ts`（Blob 边界）、`context/anchor.ts` /
  `context/memory.ts`（定时器 + fetch）。
- **`services/api/errors.ts`**：5 个导出里 4 个靠 `instanceof ApiError`；该模块 `import` 后在
  Node 里也加载不起来（实测 record 直接崩）。
- **`services/chat/history/source.ts`**：导出返回函数值，过不了桥。
- **`services/uploadExts.ts`**：整份是**一张纯数据表**，只有一个 `export const`、零函数，
  `bridge` 直接拒绝（"exports no functions"）。扩展名表已逐字（981 项，顺序与重复都保持）
  内嵌进 `attachments-rs`；真正的分类 API 在 `attachments.ts`，已移植。
- **`toArchive.ts` 的 `toSessionFile`**：签名收 `ExportImage`，其成员是函数，`bridge` 判定
  `js_only`。也就是说**导出侧的"写归档"函数无法过桥**，只有索引投影 `toIndexEntry` 可以。
- **`schema.ts` 的 `readSessionIndex`**：源码写成 `export const readSessionIndex: Read<T[]>`，
  导出提取器识别不到这种泛型标注箭头函数，因此无法桥、无法 diff。已按"不发布未验证代码"处理。

## 两个必须知道的操作陷阱

1. **`tolocal-rs` 的 `index.cjs` 需要一行补丁**：二进制 wire 路径不会 revive `$map`/`$undefined`/
   `$num` 标记，导致 TS `Map` 返回值变成普通对象、`images.get()` 失效。`build` 会保留补丁，
   **`refresh` 会冲掉**（实测冲掉后 diff 从 315/315 掉到 177/315）。refresh 后执行：
   `node rust/tolocal-rs/fix-glue.mjs`（幂等）。
2. **在本机手动跑 `cargo test` 会在链接期失败**：w64devkit 的 `ld` 处理不了非 ASCII 路径
   `D:\Code\重构\…`。`gate` 用自己的 ASCII target 目录，所以 `gate` 里的 `cargo test` 是过的。
   手动验证请加 `CARGO_TARGET_DIR=%TEMP%\ta-target`。

## 顺序理由

先协议解码（sse + parseEvent）——流式链路的地基，行为最容易用字符串用例钉死；再归档格式
（paths / schema / toLocal / toArchive / zip）——有完整格式文档和真实 import/export 边界；
最后数据表（i18n / locationData），收益低风险也低，放后面。
