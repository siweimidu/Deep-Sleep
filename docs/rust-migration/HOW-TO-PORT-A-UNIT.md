# 移植操作手册（每个单元都照这个做）

仓库根：`D:\Code\重构\deepseek`（下面所有命令都在这个目录下执行）。
工具：`rust-anything` v4.0.0 已安装；`wasm-bindgen-cli 0.2.130` 已安装；`rustfmt` / `clippy` 已安装；
`node_modules` 已安装（`pnpm install --frozen-lockfile` 跑过）。

## 一个单元的标准流程

```powershell
Set-Location "D:\Code\重构\deepseek"
$shim = "file:///D:/Code/%E9%87%8D%E6%9E%84/deepseek/rust/record-shim.mjs"

rust-anything bridge . src/services/<file>.ts          # 生成 rust/<name>-rs
rust-anything refresh  rust\<name>-rs                  # 改了 port.rs 签名后必须重跑
# 写 rust\<name>-rs\cases-extra.jsonl（手写特征用例，见下）
rust-anything record  rust\<name>-rs --inputs rust\<name>-rs\cases-extra.jsonl --node-arg=--import=$shim
# 写 rust\<name>-rs\src\port.rs
rust-anything build   rust\<name>-rs
rust-anything diff    rust\<name>-rs                    # 必须 N/N
cargo fmt --manifest-path rust\<name>-rs\Cargo.toml
rust-anything gate    rust\<name>-rs                    # 必须 Gate passed
```

`gate` 检查 fmt / clippy(-D warnings) / cargo test / build / api / behavior，全绿才算完成。

## 必须手写特征用例

`record` 默认生成的 200 条是随机字符串，对真实业务结构几乎零覆盖（`schema-rs` 自动用例 24 条里
24 条全抛错）。所以每个单元都要写 `cases-extra.jsonl`：

- 一行一个 JSON：`{"fn":"函数名","args":[...]}`；类单元是
  `{"class":"类名","ctor":[],"calls":[{"method":"m","args":[...]}]}`；
- 覆盖：正常路径、每个分支、每个拒绝分支、边界值、空值、错类型；
- 写完**必须逐行校验能解析**，否则 `record` 会静默忽略整个文件（它只报错、不记录，很容易看漏）：

```powershell
$p = "D:\Code\重构\deepseek\rust\<name>-rs\cases-extra.jsonl"
$i=0; $bad=0
foreach($l in [System.IO.File]::ReadAllLines($p)){ $i++; try { $null = $l | ConvertFrom-Json } catch { $bad++; "BAD $i" } }
"validated=$i bad=$bad"     # bad 必须为 0
```

注意 `.NET` 的 `[System.IO.File]::ReadAllLines` 不走 PowerShell 的当前目录，**必须给绝对路径**。

## 线上编码规则（踩过的坑，别重复踩）

1. `Option<T>` 的 `None` 过桥变成 `{"$undefined":true}`，**不是** `null`。源函数返回 `string | null`
   时，签名要写 `Result<serde_json::Value, String>` 并显式返回 `Value::Null`（见 `paths-rs`
   的 `parse_session_path`）；返回 `void` 时返回 `js::undefined()`（见 `schema-rs` 的 `check_manifest`）。
2. JS 的 `{ ...obj, k: v }` 等价于 `Map::insert`：`serde_json` 开了 `preserve_order`，对已存在的键
   `insert` 保持原位置、对新键追加，正好等于 JS 的对象赋值语义。
3. 源里值为 `undefined` 的字段用 `crate::js::undefined()` 写入，它和 `null` 在线上不同。
4. 抛异常 → 返回 `Err(String)`，字符串必须和 `translate(key)` 出来的文案**逐字相同**
   （默认 zh 语言）。`js::undefined()` / `js::is_undefined()` 由 crate 自带的 `src/js.rs` 提供。
5. 浮点：JS `JSON.stringify(3.0)` 是 `3`。别自己重新拼数字，尽量把原 `Value` clone 下去。
6. `Number.isSafeInteger` 之类要自己写（`as_f64` + `fract()==0` + 范围判断）。
7. JS 字符串下标是 UTF-16；纯 ASCII 定界符（`\r \n : 空格 \0 /`）在 UTF-8 里字节位置恰好也是字符
   边界，用字节扫描 + `&str` 切片是安全的；非 ASCII 切分才需要用 crate 生成的 `src/utf16.rs`。

## 边界：这些不属于本单元，别硬塞

- DOM / `window` / `document` / `navigator` / `indexedDB` / `localStorage` / `Worker` / `Blob` /
  `fetch` / `canvas` / `getUserMedia`：留在 TS，并在报告里说明是哪一条；
- `instanceof` 某个 TS 类的判断、返回函数值（回调）的导出：过不了桥，留在 TS；
- 只含类型声明（`export type`）的文件不需要移植。

`bridge` 自己会把不能桥的导出列进 `js_only`；尊重它的判断，不要为了"看起来完整"去伪造。

## 硬性约束

- **不要** `git add` / `commit` / `push`（由主 agent 统一提交）。
- **不要**修改 `src/` 下任何文件，也不要动别人的 `rust/*-rs` crate。
- **不要**为了让 diff 变绿去改 `cases.jsonl`（那是原版行为的记录，改它等于作弊）。
- 产品代码里不允许 `unwrap()` / `expect()` / `panic!()`（`gate` 会查）。
- 完成后报告：`diff` 的 N/N、`gate` 结论、`js_only`/边界清单、以及与原版任何遗留差异。

## 补充陷阱（实测）

- **纯数据文件不是单元**。`src/services/uploadExts.ts` 只有一个 `export const` 数组、零函数，
  `bridge` 会直接报 "exports no functions"。先数一下导出里有没有函数，再决定要不要开 crate。
- **`refresh` 会重写 `index.cjs` 等生成文件**。若你手改过生成文件，refresh 后必须重放补丁
  （`tolocal-rs` 就是这种情况，见其 `fix-glue.mjs`），否则 diff 会突然掉一大片。
- **手动 `cargo test` 在非 ASCII 路径下链接失败**（w64devkit 的 `ld`）。用
  `$env:CARGO_TARGET_DIR="$env:TEMP\ta-target"` 再跑；`gate` 内部的 `cargo test` 不受影响。
- **返回值里的 JS `Map`** 以 `{"$map":[[k,v],…]}` 形式过桥；二进制 wire 路径不会自动 revive，
  这是上面那条补丁存在的原因。
- 确实无法等价的用例才用 `known-diffs.jsonl` 声明，且必须写明为什么无法等价（例如 wasm 里没有
  宿主时区，V8 的 legacy 日期解析器把 `key_name-1` 按本地时区读成 2001 年）。声明后要在报告里
  明确给出"精确匹配数 / 声明数"。
