# 重构执行计划

> 已完成的部分、逐个 crate 的用例数与每条边界的原因，全部记在 [STATUS.md](./STATUS.md)。
> 本文件只保留"还剩什么、按什么顺序做、为什么"。方法见 [DESIGN.md](./DESIGN.md) 与
> [HOW-TO-PORT-A-UNIT.md](./HOW-TO-PORT-A-UNIT.md)。

## 已完成

15 个 crate / 9492 条用例，`rust-anything gate` 全绿。清单见 STATUS.md。

## 剩余工作

| 优先级 | 事项 | 阻塞点 / 说明 |
| --- | --- | --- |
| 高 | **把 Rust 接进调用点** | 目前业务代码零调用。ADOPTION.md 的步骤本机实测过（`--target web` 产出 ESM），但真机上 `Map` 返回值与首屏代价必须在设备上复验 |
| 高 | **补齐浏览器产物的参数编码** | `rust/web-parity.ps1` 已把 9897 次调用跑通记录语料；branches / budget / location / reply / view 五个 crate 的复杂结构体参数还没对上（Node 侧 100% 绿），属 harness/适配层问题 |
| 中 | `src/i18n/**` | 纯数据可移植；但 `translate` 读 zustand store，得先改成显式 `locale` 参数，否则 `view-rs` 的 `getAreaTitle` 与 `schema-rs` 的错误文案永远只有 zh-CN |
| 低 | `zipReader.ts` 剩余 5 个导出 | 字节级核心已通过接缝移植（322/322）；剩下的 `isZipFile`/`summarizeArchive`/`readArchive`/`readEntry` 是函数/生成器/Blob 边界，无法过桥 |
| 低 | 出 APK | 本机无 Android SDK/NDK，物理上做不到，不是没做 |

## 顺序理由（已完成部分当时为什么这么排）

先协议解码（sse + parseEvent）——它是整条流式链路的地基，行为最容易用字符串用例钉死；再归档格式
（paths / schema / toLocal / toArchive / zip）——有完整格式文档和真实的 import/export 边界；
然后消息模型（view / reply / budget / branches）——互相有耦合但可以各自成 crate；最后数据表
（location / attachments）——收益低、风险也低。

## 两条对后续有影响的结论

1. **每个单元一个 wasm 模块，不要试图合并**。生成的 cdylib 各自导出同名 wire 入口
   （`rustAnythingWireMemory`），两个一起链接会直接报符号重名。`budget-rs` 因此把它用到的
   `reply.ts` / `view.ts` 小片段在内部重写了一遍。
2. **纯数据文件不是单元**。`uploadExts.ts`（1 个 `export const`、零函数）与 `locationData.ts`
   （4 个 `const`）都被 `bridge` 直接拒绝；它们的数据已逐字内嵌进借用它们的 crate。
