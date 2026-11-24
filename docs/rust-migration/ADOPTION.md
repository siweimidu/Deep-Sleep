# 把 Rust 核心接进 Android WebView

下面每一步都在本机实测过，不是推测。

## 1. 生成浏览器可用的 wasm

`rust-anything build` 产出的是 **Node 目标**的胶水（内部用 `require('fs').readFileSync` 同步读
wasm），直接丢进 WebView 不行。浏览器目标要用同一条 Rust 产物重新过一遍 `wasm-bindgen`，**不需要
改 Rust 代码**。仓库里已经封装好：

```powershell
Set-Location "D:\Code\重构\deepseek"
powershell -NoProfile -ExecutionPolicy Bypass -File rust\build-web-core.ps1 -Crate paths-rs
```

产物落在 `src\rust-core\pkg\`（`*.js` + `*.d.ts` + `*_bg.wasm`），**已提交**，所以不装 Rust 工具链
也能构建这个仓库。实测尺寸：

| 产物 | 大小 |
| --- | --- |
| paths-rs | 233,503 B |
| attachments-rs | 331,679 B |
| location-rs | 241,378 B |

脚本内部要注意的一点：仓库路径含中文，`w64devkit` 的链接器处理不了，所以 `CARGO_TARGET_DIR` 被指到
纯 ASCII 的临时目录。

## 2. rspack 侧

`rspack.config.ts` 已加规则：

```ts
{ test: /\.wasm$/, type: 'asset/resource' }
```

`new URL('...', import.meta.url)` 会被 rspack 当成资源引用并自动产出 `.wasm`（落在
`dist/static/media/`）。Android 侧资产由 `WebViewAssetLoader` 以
`https://appassets.androidplatform.net/` 提供（`MainActivity.java:51`），所以 `fetch()` 取 wasm
在生产环境可用 —— **不能** 把 wasm 放在 `file://` 下，那样 fetch 读不到。

## 3. TS 适配层：已接的三个单元

| 源文件 | 适配层 | 接入的函数 |
| --- | --- | --- |
| `services/chat/history/paths.ts` | `src/rust-core/paths.ts` | `sessionPath`、`sessionFilesDir`、`parseSessionPath`、`imagePath` |
| `services/attachments.ts` | `src/rust-core/attachments.ts` | `getFileExt`、`isAcceptedExt`、`getUploadPurpose`、`isImage`、`getExtension`、`formatSize` |
| `services/location.ts` | `src/rust-core/location.ts` | `getRegionName`、`normalizeLocation` |

模式（照抄即可接下一个）：

```ts
let ready = false
const load = async () => {
  try {
    await init({ module_or_path: new URL('./pkg/x_bg.wasm', import.meta.url) })
    ready = true
  } catch {
    // Rust 是加速路径，不是依赖：加载失败就永远走原 TS 实现。
  }
}
void load()   // 模块加载即开始，不阻塞首屏
```

调用点保持同步，原实现留作回退：

```ts
export const sessionPath = (sessionId: string) =>
  rustPaths.sessionPath(sessionId) ?? `chat_sessions/${sessionId}.json`
```

`undefined` 专门表示「未就绪」，因为 `null` 本身是 `parseSessionPath` / `getUploadPurpose` 的合法
返回值。

**已知行为：初始化只尝试一次。** `load()` 失败后不会重试，该会话内就一直走 TS 实现（安全但无重试）。
在 Node 里验证时要注意顺序：fetch 垫片必须在 import 适配层**之前**装好，否则 init 会永久失败
（我就是在 `bench-archive.mjs` 里踩了这个坑）。

实测：`node rust/adapter-check.mjs` → **30/30**（走应用真正 import 的模块）；`pnpm type` 干净；
`pnpm lint` 0 warning 0 error；`pnpm build` 成功，四个 wasm 都被产出并被 bundle 引用。

### 接线之后必须**重新录制**

`gate` 除了 fmt/clippy/test/behavior，还有一个 `recording` 检查：单元源码一旦在录制之后改动，就报
`src/… changed since it was recorded`。把函数体换成「委托给 Rust」正好会触发它——这不是 bug，是工具
在提醒"录的和现在的原版不是同一份"。

处理办法就是它说的：接线完成后重新 `record`。**这不会变成自证循环**：录制环境里适配层初始化必然
失败（Node 没有 `file://` 的 fetch），于是回退到 TS 实现，录下来的仍是原版行为。有直接证据：
`zipreader-rs` 重录后的 300 条错误里有一条是
`The encoded data was not valid for encoding utf-8` —— 这是 `TextDecoder` 的报错，Rust 侧不可能产生
（它把 utf8 错误映射成 `Invalid or unsupported history archive`）。

## 4. 两个胶水**不等价**（务必先读）

`rust-anything diff` 验的是 Node 胶水；进 WebView 的是 `--target web` 的另一套。实测差异：

| 情形 | Node 胶水 | 浏览器胶水 | 适配层要做什么 |
| --- | --- | --- | --- |
| `serde_json::Value` 参数 | 自动 encode | `.d.ts` 写的是 `(value: string)` | `JSON.stringify(参数)`，且**不要**先还原标记 |
| `serde_json::Value` 返回值 | 自动 decode | 返回**JSON 文本** | `JSON.parse` 之后再做标记还原 |
| 源导出是 `async` | 内部处理 | 返回 Promise | `await` |
| 缺省的尾随可选参数 | 编码成 `$undefined` 标记 | 传 `undefined` 会崩 | 补 `{"$undefined":true}` 的文本 |

**同一个 crate 里返回编码也可能不一样**：`location-rs` 的 `getRegionName` 直接返回字符串，而同
crate 的 `normalizeLocation` 返回 JSON 文本。判据是生成的 `index.cjs` 里每项的 `'json'` 标记，或
`port.rs` 的 Rust 返回类型 —— 不要按 TS 类型猜（`'a' | 'b'` 是 `String`，`unknown` 才是 `Value`）。

wire 标记一共五种，还原函数必须全支持：
`{"$undefined":true}`、`{"$num":"NaN"}`、`{"$map":[[k,v],…]}`、`{"$set":[…]}`、`{"$bytes":[…]}`。

验证：`rust/web-parity.ps1` 把 15 个 crate 的录制语料回放到浏览器产物上，**10626 次调用通过**，
每个 crate 的数字与 Node 侧 gate 逐一对齐（`tolocal` 只差它已声明的 6 条时区差异）。

## 5. 什么时候**值得**接：边界成本的实测数字

`rust/bench-boundary.mjs` 量了同一份逻辑走 wasm 还是走原 TS：

| 调用形状 | TypeScript | Rust（JSON 文本边界） | 结论 |
| --- | --- | --- | --- |
| `getFileExt('photo.PNG')` 字符串进字符串出 | 0.0001 ms | 0.0010 ms | Rust **慢约 9 倍** |
| `getVisibleMessages`，50 条消息（15 KB） | 0.0086 ms | 0.2226 ms | 慢约 26 倍 |
| 同上，200 条（61 KB） | 0.0284 ms | 0.9037 ms | 慢约 32 倍 |
| 同上，800 条（248 KB） | 0.1129 ms | 5.5349 ms | 慢约 49 倍 |

原因不是 Rust 慢，是**边界贵**：JSON 文本要 `stringify` 整个入参、`parse` 整个出参，比它包住的
逻辑本身贵一到两个数量级。

**所以**：

- 只在 **(Rust 里干的活) 远大于 (搬运成本)** 时才接 —— 大输入、小输出、计算密集；
- 「整对象进、整对象出」的变换（消息树、reply view）**不要接**，会慢几十倍；
### 结论：只有「字节进 / 计算密集 / 输出小」划算 —— 且已实测

| 800 条消息（248 KB）整对象变换 | ms/op | 相对 TS |
| --- | --- | --- |
| TypeScript | 0.0886 | 1x（基准） |
| JSON 文本路径 | 5.0395 | 慢约 57 倍 |
| 二进制 wire 路径 | 8.0448 | 慢约 91 倍 |

| 1.1 MB 归档（41 条，STORE）解析 | ms/op | 相对 TS |
| --- | --- | --- |
| `parseArchiveBase64InTypeScript` | 99.59 | 1x（基准） |
| Rust 直调 | 19.35 | **快 5.15 倍** |
| **应用实际走的路径（已接）** | **19.36** | **快 5.14 倍** |

`rust/bench-archive.mjs` 可复现，且校验两边输出逐字节一致。真实 DeepSeek 导出就是 STORE，
所以这是有代表性的形状。

**判据**：

- **字节进、计算密集、输出小** → 值得接（归档解析快 5 倍，CRC 与目录扫在 Rust 里是原生代码）；
- 整对象进出（消息树、reply view、budget）→ **不要接**，慢 30–91 倍；
- 小函数（`getFileExt` 之类）→ 每次约 1 µs 固定边界成本，比操作本身贵一个数量级，别提速。

所以已接的三个单元定位是**正确性试点**，不是性能优化：验证了「Rust 能在生产链路跑起来」这件事，
而不是「跑得更快」。

已接的三个单元**是正确的，但不是提速**：调用频率低，每次 ~1 µs 可忽略；它们的价值是「Rust 真的在
线上跑」这条链路已经打通并验证。

## 6. 随时复验

一条命令跑完四层：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File rust\verify-all.ps1
# 期望最后一行：ALL GREEN: 16 crates gated, browser artifact + adapters verified.
```

单跑某一层：

```powershell
rust-anything diff rust\<crate>       # Node 胶水：必须 N/N
rust-anything gate rust\<crate>       # 必须 Gate passed（接线后记得先重录）
powershell -NoProfile -ExecutionPolicy Bypass -File rust\web-parity.ps1   # 浏览器产物：必须 exit 0
node rust\adapter-check.mjs           # 适配层：必须全过
node rust\bench-boundary.mjs          # 边界成本，决定要不要接
node --import ./rust/record-shim.mjs --import ./rust/register-ts.mjs rust\bench-archive.mjs
node rust\tolocal-rs\fix-glue.mjs     # 只在跑过 refresh 之后需要
```

## 7. 还没做的（如实说明）

- **大部分 crate 还没接进调用点**：15 个里接了 3 个。按第 5 节的结论，消息树/reply/view/budget
  这几个**故意不接**（接了会慢几十倍），除非先做二进制 wire。
- `validateFiles` / `resolveMimeType` 未接：入参是 `File`，需要先做 `File → {name,size,type}` 映射。
- **没法在本机出 APK**：没有 Android SDK/NDK（`ANDROID_HOME` 为空，
  `$LOCALAPPDATA\Android\Sdk` 不存在），Rust 的 android target 虽装但缺 NDK 链接器。
- 真机上的首屏与内存代价没测。
