# 性能实测：哪些单元真的值得用 Rust

判据只有一条：**同一份逻辑，走 Rust 是否比原 TypeScript 快。** 每条都在本机实测，先断言两边输出
深相等，再计时；`ratio = ts / rust`，`> 1` 表示 Rust 更快。5% 以内算噪声，判 `TS`（因为保持 TS 是零成本）。

复现：`powershell -NoProfile -ExecutionPolicy Bypass -File rust\bench.ps1 -Name <crate>`
（`rust/bench/*.mjs`，共享 `rust/bench/lib.mjs`；它会用 wire 标记模型做深比较，然后计时）

## 结论：16 个 crate 里只有 2 个值得接

| 单元 | 形状 | 实测 ratio | 判定 |
| --- | --- | --- | --- |
| **`zipReader.parseArchiveBase64`** | 1.1 MB 归档字节进、小目录出 | **5.14×**（99.59 → 19.35 ms） | ✅ **接** |
| **`budget.estimateTokens`** | 长字符串进、一个数出 | **1.2–1.8×**（≥128 单元；饱和不再涨） | ✅ **接**（带阈值） |
| `budget.planContext` | 整个 history 进出 | 0.02–0.32 | ❌ 留 TS |
| `schema.readSessionFile` | 350 KB 会话进出 | 0.04–0.20 | ❌ |
| `tolocal.toLocalSession` | 350 KB 会话 + Map 出 | 0.05–0.07 | ❌ |
| `toarchive.toIndexEntry` | 350 KB 进、6 个字段出 | **0.00**（2.15 ms vs 0.3 µs） | ❌ |
| `branches.getVisibleMessages` | 会话树进出 | 0.00–0.02 | ❌ |
| `view.buildReplyView` | 整条回复进、视图出 | 0.03（70 µs → 2.2 ms） | ❌ |
| `reply.applyEvent`（流式增量） | 每条 delta 都要重序列化整条回复 | **0.00（600–1000× 慢）** | ❌ |
| `sse.decodeStream` | 6 KB 流 / 10 块 | 0.21 | ❌ |
| `parseevent.readMessageEvent` | 单个事件 | 0.02–0.08 | ❌ |
| `index.translateFor` / `isTranslationKey` | 短字符串 | 0.20–0.41 | ❌ |
| `zipwriter.writeArchive` | 200–2000 条目 | 0.26–0.51（仅 0–4 条目时 2.7×） | ❌ |
| `documenttext.extensionOf` | 4 行逻辑 | 0.20–0.33 | ❌ |
| `paths.*` / `attachments.*` / `location.*` | 短字符串 / 小对象 | 约 0.11（`getFileExt` 慢 9×） | ❌ **已回退** |

## 三条比数字本身更重要的结论

1. **贵的是"输入过边界"，不是"输出"**。`toarchive.toIndexEntry` 只返回 6 个字段，却是最差的一档
   （0.00）：因为 350 KB 的会话必须整个跨进 wasm。指望"小输出"救不了，输入才是账单。
2. **短函数永远别接**。每次调用约 1–2 µs 的固定边界成本，比它包住的那点字符串操作贵一个数量级
   （`getFileExt` 慢 9×、`extensionOf` 慢 4–5×）。
3. **`estimateTokens` 有阈值，且是反向的**。16 个 UTF-16 单元时 Rust 只有 0.64×（更慢）；64 单元
   打平；128 单元起 1.2–1.8× 并在 1.5–1.8× 饱和（1 KB 1.62×、100 KB 1.81×、1 MB 1.71×）。
   所以阈值判断放在调用点：`text.length >= 128` 才走 Rust，短文本走原实现。

## 顺带发现的一个真实缺陷

`zipwriter-rs` 用 `Vec<String>` + `contains` 去重（O(n²)），而原版用 `Set.has`。拟合出来
2000 条目时约 70% 的时间花在这个扫描上。它现在没被接入，所以不影响用户，但这是移植里唯一一处
**算法退化**，记录在此。即便修掉，JSON 边界也会把它拉回原点，所以不值得修来提速。

## 已经接进应用的只有两个

| 单元 | 位置 | 证据 |
| --- | --- | --- |
| 归档解析 | `src/rust-core/zipReader.ts` → `history/zipReader.ts` | 5.14×，且失败时回退 TS 以保留 `ArchiveError` 语义 |
| token 估算 | `src/rust-core/budget.ts` → `context/budget.ts`（≥128 单元） | 1.2–1.8×，两侧结果一致由 `adapter-check.mjs` 逐样本验证 |

APK 里因此只带这两个 wasm：`zipreader_rs_bg` 299,960 B + `budget_rs_bg` 246,019 B。
其余三个（paths / attachments / location）已按同一判据**回退**，源文件用
`git checkout` 还原到接线前的版本。
