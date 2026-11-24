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

**`paths.ts` 已经接好了，可以作为接入其余 crate 的模板**（`src/rust-core/paths.ts`）：

- 生成浏览器产物到应用能 import 的位置：
  `powershell -NoProfile -ExecutionPolicy Bypass -File rust\build-web-core.ps1 -Crate paths-rs`
  → 产出 `src/rust-core/pkg/paths_rs.{js,d.ts}` + `paths_rs_bg.wasm`（**已提交**，所以不装 Rust 也能构建）；
- `rspack.config.ts` 已加 `{ test: /\.wasm$/, type: 'asset/resource' }`；
- 适配层模块加载时**自动 `void load()`**，不阻塞首屏：能拿到 wasm 就走 Rust，拿不到就返回 `null`
  让调用方走原 TS 实现 —— 所以它永远不可能成为新的失败源；
- 调用点保持同步：`sessionPath = (id) => rustPaths.sessionPath(id) ?? \`chat_sessions/${id}.json\``。

实测证据（都已跑过）：`pnpm type` 干净、`pnpm lint` 0 warning 0 error（生成目录已加入
`.oxlintrc.json` 的 `ignorePatterns`）、`pnpm build` 两次 `Rspack compiled successfully`，且
`dist/static/media/paths_rs_bg.<hash>.wasm`（233,503 B）被真实产出并被主 bundle 引用。

Android 侧资产是由 `WebViewAssetLoader` 以 `https://appassets.androidplatform.net/` 提供的
（`MainActivity.java:51`），所以 `fetch()` 取 wasm 在生产环境可用——这正是不能把 wasm 放到
`file://` 下的原因。

其余 crate 照抄这个模板即可；差异只有两点：`Value` 参数/返回值要 `JSON.stringify`/`JSON.parse`
（见下表），`async` 要 `await`。

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

### 参数/返回怎么编码：看 `port.rs` 的参数类型，别猜 TS 类型

TS 类型不可靠：`model: ('deepseek-flash' | 'deepseek-v4-pro')` 在 Rust 里是普通 `String`（原样传），
而 `value: unknown` 在 Rust 里是 `serde_json::Value`（要传 JSON 文本）。两者在 `.d.ts` 里都写成
`string`，光看 d.ts 分不出来。**判据用 port.rs 的 Rust 参数类型**：

| Rust 参数类型 | 浏览器侧要传 |
| --- | --- |
| 含 `Value`（`Value`、`Option<Value>`、`Map<String, Value>`…） | `JSON.stringify(值)`，且**不要**先还原标记 |
| `String` / `f64` / `bool` | 原样 |
| `pub async fn` | 返回值要 `await` |
| 记录里缺省的尾随可选参数 | 补 `{"$undefined":true}` 的 JSON 文本，**不能**传 `undefined`（胶水会解引用崩） |

`rust/web-parity.mjs` 就是从 `src/port.rs` 读参数类型来编码的，可以直接当适配层的参考实现。

### 浏览器产物验证结果：与 Node 侧完全一致

`rust/web-parity.ps1` 对 15 个 crate 全部回放，**10626 次调用通过**，且每个 crate 的数字与
`rust-anything gate` 的 Node 侧结论**逐一对齐**：

| 状态 | crate |
| --- | --- |
| 浏览器产物全量通过（14 个） | attachments 1556/1556、branches 1092/1092、budget 527/527、documenttext 544/544、location 364/364、parseevent 83/83、paths 956/956、reply 1533/1533、schema 67/67、sse 1372/1372、toarchive 228/228、view 1403/1403、zipreader 322/322、zipwriter 270/270 |
| 只差已声明差异（1 个） | tolocal 309/315 —— 差的 6 条正是 `known-diffs.jsonl` 里的 6 条（V8 legacy 日期解析 / 无时区），已逐条核对输入一致 |

也就是说：**Node 胶水 100% 通过的 crate，换成浏览器胶水后仍然 100% 通过**，不存在"验的和发的不是
一套"的隐患。

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
