# 重构执行计划

判定依据见 [DESIGN.md](./DESIGN.md)。每个单元的完成条件是 `diff` 全绿 + `gate` 通过。

## 状态

| 波次 | 单元 | 行数 | 状态 |
| --- | --- | --- | --- |
| W0 | `services/api/sse.ts`（ServerSentEventDecoder） | 136 | ✅ gate 通过，232/232 |
| W1 | `services/api/parseEvent.ts` | 231 | ✅ gate 通过，83/83 |
| W2 | `services/chat/history/schema.ts` | 263 | 待做 |
| W2 | `services/chat/history/format.ts` | 208 | 待做 |
| W2 | `services/chat/history/paths.ts` | — | 待做 |
| W2 | `services/chat/history/describe.ts` | — | 待做 |
| W2 | `services/chat/history/normalize.ts` | — | 待做 |
| W2 | `services/chat/history/toArchive.ts` | — | 待做 |
| W2 | `services/chat/history/toLocal.ts` | — | 待做 |
| W2 | `services/chat/history/sessionGroups.ts` | — | 待做 |
| W2 | `services/chat/history/sessionSearch.ts` | — | 待做 |
| W3 | `services/chat/history/zipReader.ts`（纯解析核心） | 360 | 待做 |
| W3 | `services/chat/history/zipWriter.ts`（纯编码核心） | 140 | 待做 |
| W3 | `services/chat/context/budget.ts` | 129 | 待做 |
| W3 | `services/chat/branches.ts` | 110 | 待做 |
| W4 | `services/uploadExts.ts` | 985 | 待做 |
| W4 | `services/locationData.ts` | 448 | 待做 |
| W4 | `src/i18n/**` | 574 | 待做 |
| W5 | `services/documentText.ts` | 119 | 待做 |
| W5 | `services/attachments.ts` | 214 | 待做 |
| W6 | 合并为单一 `deepseek-core` wasm crate + TS 适配层 + 浏览器烟测 | — | 待做 |

## 明确留在 TS（平台绑定，不是未完成项）

`clipboard.ts`（DOM execCommand）、`id.ts`（crypto/Math.random）、`settings.ts`（localStorage）、
`appUpdate.ts`（fetch + window 事件）、`imageUpload.ts`（canvas）、`speech/recorder.ts`
（getUserMedia）、`chat/store.ts`（document/window 生命周期）、`markdown/parseWorker.ts` 与
`history/inflateWorker.ts`（Worker）、`exportArchive.ts` / `importArchive.ts` / `linkImport.ts`
（Blob 下载/上传边界）、`context/anchor.ts` 与 `context/memory.ts`（window 定时器 + fetch）。

`zipReader` / `zipWriter` 只有返回 `Blob` 那一层是平台绑定的，压缩解压与条目解析本身是纯逻辑，
所以移植内核、由 TS 侧的薄适配层负责 `Blob` 包装。

`services/api/errors.ts` 整份留在 TS：5 个导出里 3 个（`classifyApiError`、
`isRetryableApiError`、`getFileErrorCode`、`getUploadErrorInfo`）都靠 `instanceof ApiError`
判断，类身份过不了桥；剩下 2 个（`classifyStatus`、`extractFileIds`）是边角，而且该模块
`import { ApiError } from './client.js'` 后在 Node 里根本加载不起来（实测 record 直接崩），
所以它不是一个能独立成 crate 的单元。

## 顺序理由

先做协议解码（sse + parseEvent）——它是整条流式链路的地基，行为最容易用字符串用例钉死；
再做归档格式（history 全组），因为它有完整的格式文档和真实的 import/export 边界；最后做数据表
（uploadExts/locationData/i18n），这类移植收益低但风险也低，放后面避免占用早期注意力。
