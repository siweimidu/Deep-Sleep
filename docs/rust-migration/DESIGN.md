# DeepSleep → Rust 重构设计

基线：本仓库 `main` 的 `deepseek-app-replica` 原始源码（Android 容器 + React 前端）。
工具：`rust-anything` v4.0.0（record → port → build → diff → gate）。

## 目标

把 DeepSleep 的 **TypeScript 服务层逻辑** 逐单元重写为 Rust，并用 rust-anything 的
record/diff **证明行为与原版一致**；React 前端与视觉还原度不动。

## 为什么是这个范围（不是「连 UI 一起 Rust」）

`rust-anything analyze` 独立给出的判定就是这个边界——86 个源文件里 61 个 UI 文件全部判为
`keep`（不能过桥），22 个单元里只有 5 个 `ready`、5 个 `caution`：

| 层 | 规模 | 判定 |
| --- | --- | --- |
| React 组件 / 样式（61 文件） | ~19.5k 行 | `keep`，留在 TS |
| `src/services/**`（86 源文件中的逻辑部分） | ~8.8k 行 | 可移植，本设计的对象 |
| Android Java 容器（10 文件） | ~1.6k 行 | 需 NDK，本机无，暂不动 |

润色的目标不是「代码里没有 TS」，而是**逻辑内核是 Rust 且被证明等价**。把 19.5k 行 CSS/JSX
换成 Rust UI 工具包既无法用 record/replay 验证（像素不在桥的能力范围），又会牺牲本项目唯一的
价值主张——对官方客户端的视觉复刻。

## 桥的选择：wasm-bindgen

运行时是 Android WebView，所以产物必须是能在浏览器里跑的 wasm；Node 也能直接实例化同一份
wasm，因此**验证与上线用同一个产物**，不存在「验证的是 napi、发的是另一套」的偏差。
`analyze` 的建议与此一致。

## 验证协议（一个单元算「完成」的必要条件）

1. `bridge` 生成 crate；
2. `record`：自动随机用例 + **手写特征用例**（`cases-extra.jsonl`）——随机字符串永远拼不出
   真实 SSE 流，只靠自动用例覆盖率是假的；
3. 写 `src/port.rs`；
4. `build` 通过；
5. `diff` 全绿；
6. `gate` 通过。

**没有 diff 全绿的单元，不算移植完成。** 每条 port 里的 `#[cfg(test)]` 只做快速回路，最终
判据是 diff。

## 单元挑选规则（不能只信 analyze 的目录粒度）

`analyze` 按目录判分，会把整个 `src/utils/` 判成 `ready`，但里面：

- `clipboard.ts` —— 纯 DOM（`document.execCommand`），不可移植，必须留 TS；
- `id.ts` —— `crypto.randomUUID` + `Math.random`，本质是平台 API 包装，移植无意义；
- `format.ts` —— 真纯逻辑，可移植。

所以**逐文件判断**：有 DOM / `window` / `crypto` / `navigator` / IndexedDB / Worker 的，
一律留 TS 并在文档里登记。

## 已知约束与风险

- **本机没有 Android SDK/NDK**：无法在这里构建 APK，因此交付物是 Rust crate + wasm 产物 +
  接入说明，不是安装包。Rust 的 android target 已装但缺 NDK 链接器。
- **JS 数值/字符串语义**：`estimateTokens` 之类含浮点的逻辑用 `--float-tolerance`；字符串索引用
  生成好的 `utf16.rs`，不用字节下标冒充。
- **平台绑定面永远不会变成 Rust**（剪贴板、IndexedDB、TextDecoder、fetch）；这部分是设计上的
  边界，不是未完成项。

## 非目标

- 不改 React 组件、不改视觉；
- 不迁 Android Java 原生层（无 NDK，无法验证）；
- 不引入新的前端框架。
