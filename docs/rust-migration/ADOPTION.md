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
