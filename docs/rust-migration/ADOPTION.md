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

实测：`node rust/adapter-check.mjs` → **30/30**（走应用真正 import 的模块）；`pnpm type` 干净；
`pnpm lint` 0 warning 0 error；`pnpm build` 成功且三个 wasm 都被产出并被 bundle 引用。

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
- 要给热路径真正提速，得走**二进制 wire**：`*Wire` + `rustAnythingWireIn/Out/Memory`。

  它**不是**「把 JSON 文本塞进内存」——我核对过生成的 `index.cjs`：`wStr = s => { wU8(4); wUnits(s) }`
  这类带 tag 的编码，值是逐字段写进内存的（tag + UTF-16 单元），结果也从内存按同样格式读回，
  全程没有 `JSON.stringify`/`JSON.parse`。而且这套编解码（`wDyn` / `rDyn` / `wU8` / `wU32` /
  `wStr` / `wUnits`）是**通用**的，不是每函数生成的，所以可以整体搬进浏览器适配层复用。
  每个函数只有一小段 `encode`（记录参数个数/类型）是生成的。

  代价是：这需要在适配层自己搭一套内存访问（`rustAnythingWireMemory()` → 写 → `fn(len)` →
  `rustAnythingWireOut()` → 读），并且**尚未在浏览器产物上验证过**——目前只是一个有依据的方向，
  不是一个已完成的结论。

已接的三个单元**是正确的，但不是提速**：调用频率低，每次 ~1 µs 可忽略；它们的价值是「Rust 真的在
线上跑」这条链路已经打通并验证。

## 6. 随时复验

```powershell
rust-anything diff rust\<crate>       # Node 胶水：必须 N/N
rust-anything gate rust\<crate>       # 必须 Gate passed
powershell -NoProfile -ExecutionPolicy Bypass -File rust\web-parity.ps1   # 浏览器产物：必须 exit 0
node rust\adapter-check.mjs           # 适配层：必须全过
node rust\bench-boundary.mjs          # 边界成本，决定要不要接
node rust\tolocal-rs\fix-glue.mjs     # 只在跑过 refresh 之后需要
```

## 7. 还没做的（如实说明）

- **大部分 crate 还没接进调用点**：15 个里接了 3 个。按第 5 节的结论，消息树/reply/view/budget
  这几个**故意不接**（接了会慢几十倍），除非先做二进制 wire。
- `validateFiles` / `resolveMimeType` 未接：入参是 `File`，需要先做 `File → {name,size,type}` 映射。
- **没法在本机出 APK**：没有 Android SDK/NDK（`ANDROID_HOME` 为空，
  `$LOCALAPPDATA\Android\Sdk` 不存在），Rust 的 android target 虽装但缺 NDK 链接器。
- 真机上的首屏与内存代价没测。
