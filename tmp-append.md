
### 子页返回：揭开的是设置首页，不是聊天页（用户报的 bug）

之前设置里所有子页（账号管理、第三方模型、数据管理…）共用同一个可返回层：
手势滑走的是**整个设置层**，于是揭开的是它下面的聊天页 —— 在「账号管理」里返回看到首页聊天，是错的。

改法是把页面体抽成 `renderBody(shown)`，子页时同时渲染两层：

```
<section class="page">              ← 只有首页时它才是手势舞台（关掉设置、露出聊天页）
  <div class="under" aria-hidden>   ← 被压住的上一页（首页，或 export 时的「数据管理」）
  <div class="stack" data-back-stage> ← 当前子页，滑走的是它
```

`backGesture` 里用互补的 `active` 挂两个 hook：`page === 'root'` 时滑整块设置层，
否则只滑 `.stack`。子页返回（invoked）落到 `back()`，回到首页而不是关掉设置。

真实 Chromium（Android 桥打桩）里量到的：

```
REST   stackX=0   stackBg=rgb(22,22,22)  underHasRoot=true  stackHasAvatar=true
MID    stackX=77  active=true                                  ← p=0.5
FAR    stackX=138 active=true                                  ← p=0.9
CANCEL stackX=0
```

截图：左侧完整露出设置首页（账户/应用/语音/关于），右侧「账号管理」带圆角与投影滑出。

修这个的过程中还发现一处 CSS 放置错误：`.under` / `.stack` 被写进了 `.scroll {}` 里面，
编译成 `.scroll .stack`，页面上等于没生效（子页背景透明、手势中会透出首页）。
构建产物里检查选择器才看出来 —— 纯看源码和 tsc 都发现不了。

**真机复验待补**：改完这版时手机从 adb 掉线（`adb devices` 为空、`adb reconnect` 无效），
所以这一条证据来自桌面 Chromium（同一份构建产物、同一套 CSS/JS，只把 Android 桥换成桩）。
手机接回来后建议再跑一次 `probe-subpage-back`。
