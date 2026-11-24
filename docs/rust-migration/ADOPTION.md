# 把 Rust 核心接进 Android WebView

下面每一步都在本机实测过，不是推测。

## 1. 生成浏览器可用的 wasm

`rust-anything build` 产出的是 **Node 目标**的胶水（内部用 `require('fs').readFileSync` 同步读
wasm），直接丢进 WebView 不行。浏览器目标要用同一条 Rust 产物重新过一遍 `wasm-bindgen`，**不需要
改 Rust 代码**：

```powershell
Set-Location "D:\Code\重构\deepseek"
# 仓库路径含中文，链接/构建请把 target 指到纯 ASCII 路径
$env:CARGO_TARGET_DIR = "$env:TEMP\rustb"

cargo build --manifest-path rust\sse-rs\Cargo.toml --target wasm32-unknown-unknown --release
wasm-bindgen "$env:TEMP\rustb\wasm32-unknown-unknown\release\sse_rs.wasm" `
  --target web --out-dir rust\sse-rs\web
```

实测结果（sse-rs）：

| 产物 | 大小 |
| --- | --- |
| cargo 原始 wasm | 96,439 B |
| `wasm-bindgen --target web` 之后的 `sse_rs_bg.wasm` | 76,166 B |
| 胶水 `sse_rs.js` | 9,263 B（`export class ServerSentEventDecoder`，标准 ESM） |

`--target web` 的输出是 ESM：默认导出是 `init`（可以传 wasm 的 URL，也可以传已取到的
`WebAssembly.Module`），命名导出就是各单元的函数/类。

## 2. rspack 侧

`new URL('...', import.meta.url)` 会被 rspack 当成资源引用并自动产出 `.wasm`，这是把 wasm 放进
WebView 资源目录最省事的做法：

```ts
import init, { ServerSentEventDecoder } from '../rust/sse-rs/web/sse_rs.js'

const wasmUrl = new URL('../rust/sse-rs/web/sse_rs_bg.wasm', import.meta.url)
await init({ module_or_path: wasmUrl })
```

Android 容器用 `WebViewAssetLoader`/`assets` 提供页面时，`import.meta.url` 解析出的相对路径同样有效；
不需要额外的 MIME 配置，因为 wasm 是通过 `fetch` 取字节再实例化的。

## 3. TS 适配层（按需开启，可回退）

不建议一次性全切。每个单元都保留原 TS 实现，加一个开关：

```ts
let rust: typeof import('./sse_rs.js') | null = null

export const loadRustCore = async () => {
  if (!rust) {
    const mod = await import('./sse_rs.js')
    await mod.default({ module_or_path: new URL('./sse_rs_bg.wasm', import.meta.url) })
    rust = mod
  }
  return rust
}
```

调用点写成 `const decoder = useRust ? new (await loadRustCore()).ServerSentEventDecoder()
: new ServerSentEventDecoder()`，出问题把开关关掉即可回到纯 TS。

**注意 `Map` 返回值**：`toLocalSession`、`branches` 这类返回 JS `Map` 的单元，二进制 wire 路径需要
`index.cjs` 里那行 `return revive(t)` 补丁（见 `rust/tolocal-rs/fix-glue.mjs`）。换成
`--target web` 的胶水后这条路径不同，仍需在真机上确认 `images instanceof Map === true` ——
这是唯一一处**必须在真机复验**、本机无法替你确认的点。

## 1.5 浏览器胶水和 Node 胶水**不等价**（实测，务必先读这段）

`rust-anything diff` 验的是 Node 胶水（内部 `require('fs')` 读 wasm 那套）；真正进 WebView 的是
`--target web` 的 ESM。两者对同一份 Rust 的调用约定不同，`rust/web-parity.mjs` 就是为了把这件事
量出来（对着录制语料回放浏览器产物）：

```powershell
# 逐 crate 复验浏览器产物（会先 cargo build 出原始 wasm，再 wasm-bindgen --target web）
powershell -NoProfile -ExecutionPolicy Bypass -File rust\web-parity.ps1
```

实测到的三条约定差异，**接入时必须照做**：

| 情形 | Node 胶水 | 浏览器胶水 | 适配层要做什么 |
| --- | --- | --- | --- |
| `serde_json::Value` 参数 | 自动 encode | `.d.ts` 写的是 `(value: string)` | `JSON.stringify(参数)`，且**不要**先 revive（`$undefined` 等标记要留给 Rust 认） |
| `serde_json::Value` 返回值 | 自动 decode | 返回**JSON 文本** | `JSON.parse` 之后再做标记还原 |
| 源导出是 `async` | 内部处理 | 返回 Promise | `await` |

wire 标记一共五种，适配层的还原函数必须全支持：
`{"$undefined":true}`、`{"$num":"NaN"}`、`{"$map":[[k,v],…]}`、`{"$set":[…]}`、`{"$bytes":[…]}`。

### 当前浏览器产物的验证结果（`rust/web-parity.mjs`，9897 次调用通过）

9 个 crate 在浏览器产物上 **全量通过**：`attachments-rs` 1556/1556、`documenttext-rs` 544/544、
`parseevent-rs` 83/83、`paths-rs` 956/956、`schema-rs` 67/67、`sse-rs` 1372/1372、
`toarchive-rs` 228/228、`zipreader-rs` 322/322、`zipwriter-rs` 270/270。
`tolocal-rs` 309/315 —— 差的 6 条正是它已声明的 `known-diffs`（宿主时区日期解析）。

**还没在浏览器产物上跑通**：`branches-rs` 911/1092、`budget-rs` 516/527、`location-rs` 342/364、
`reply-rs` 1308/1533、`view-rs` 1113/1403。症状是这些函数的**复杂结构体参数**在浏览器胶水里报
`Cannot read properties of undefined (reading 'length')`，即我的 harness 的参数编码还没完全对上
（Node 胶水的 encode 比"JSON.stringify 非原始类型"更细）。**这不影响 Rust 逻辑本身**——Node 侧
`diff` 对这些 crate 是 100% 通过的，问题在适配层的参数编码，属于接入时要补的活，不是移植错误。

## 4. 随时复验等价性

```powershell
rust-anything diff rust\<crate>     # 必须 N/N
rust-anything gate rust\<crate>     # 必须 Gate passed
node rust\tolocal-rs\fix-glue.mjs   # 只在跑过 refresh 之后需要
```

## 5. 当前没有做的事（如实说明）

- **没有接入任何调用点**：`src/` 一行未改，所以现在跑起来的仍是原来的 TS。接进去是上面第 2、3 步
  的活，属于开关式上线，风险可控但没有做。
- **没法在本机出 APK**：这台机器没有 Android SDK/NDK（`ANDROID_HOME` 为空，`$LOCALAPPDATA\Android\Sdk`
  不存在），Rust 的 android target 虽已装但缺 NDK 链接器。所以只交付到 wasm 产物 + 接入步骤。
- 真机上的 wasm 体积/首屏代价未测。10 个单元合起来约 0.9 MB（未压缩），按需 `import()` 可以只加载
  用到的那个。
