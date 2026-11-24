// 往原生镜像里种一份**真实形状**的会话，用于在没有 API Key 的情况下可视化验证界面。
//
// 关键：消息必须构成 parentId 链，且每个父节点的 selectedChildId 指向它的下一条，
// 否则 buildReplyView 会把它们当成同一节点的多个版本（界面显示成 "1 / 10" 翻页）。
const now = Date.now()
const long = '这是一段用来撑高消息列表的正文，方便验证“回到底部”按钮与滚动行为。'.repeat(6)

const specs = [
  ['user', '帮我看两个东西：一段行内代码的排版，和一个公式的复制。'],
  [
    'assistant',
    '行内代码在这里：`const answer = 42`，后面还有普通文字，用来检查它与正文的基线是否对齐。\n\n再给一段代码块：\n\n```ts\nconst value = compute(a, b)\nconsole.log(value)\n```\n',
  ],
  ['user', '公式呢？'],
  [
    'assistant',
    '行内公式 $E = mc^2$ 应该和文字在同一基线上。\n\n行间公式：\n\n$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$\n\n' + long,
  ],
  ['user', '再来几轮把列表撑长。'],
  ['assistant', long],
  ['user', '继续。'],
  ['assistant', long],
  ['user', '最后一条。'],
  ['assistant', '好，这是最后一条回答。' + long],
]

const messages = []
specs.forEach(([role, text], index) => {
  const id = (role === 'user' ? 'u' : 'a') + (index + 1)
  const parent = index === 0 ? null : messages[index - 1].id
  const base = {
    id,
    role,
    createdAt: now - (specs.length - index) * 1000,
    parentId: parent,
  }
  if (role === 'user') {
    messages.push({ ...base, content: text, files: [] })
  } else {
    messages.push({
      ...base,
      model: null,
      prefix: false,
      status: 'done',
      blocks: [{ type: 'text', text }],
    })
  }
  if (index > 0) {
    messages[index - 1].selectedChildId = id
  }
})

const session = {
  id: 'probe-mirror-1',
  title: '验证会话（镜像注入）',
  createdAt: now - specs.length * 1000,
  updatedAt: now,
  messages,
  rootMessageId: messages[0].id,
  // 摘要数据：验证"上下文摘要"卡片是否能被渲染出来
  anchor: {
    text: '用户最初要求验证两件事：行内代码与正文的基线是否对齐，以及含公式的选区复制出来是什么。后续把验证范围扩展到滚动行为、镜像恢复与宽屏布局。',
    upTo: 'a2',
    createdAt: now - 8500,
  },
  memory: [
    {
      index: 0,
      fromRound: 3,
      toRound: 4,
      text: '列表需要足够长的内容才会出现"回到底部"按钮，因此后续轮次都塞了长段落。',
      createdAt: now - 4000,
    },
  ],
}

const t = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = t.find((x) => x.type === 'page')
const w = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => w.addEventListener('open', r, { once: true }))
const ev = (expr) =>
  new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1e9)
    const on = (e) => {
      const m = JSON.parse(e.data)
      if (m.id === id) {
        w.removeEventListener('message', on)
        const res = m.result?.result
        resolve(res?.subtype === 'error' ? 'EXC ' + res.description : (res?.value ?? null))
      }
    }
    w.addEventListener('message', on)
    w.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression: expr, returnByValue: true, awaitPromise: true },
      }),
    )
  })

const payload = JSON.stringify(JSON.stringify(session))
console.log('写入镜像:', await ev(`(function () { try { DeepSeekAndroid.mirrorPut('probe-mirror-1', ${payload}); return 'ok' } catch (e) { return 'err ' + e } })()`))
console.log(
  '镜像内的消息链:',
  await ev(`(function () {
    var arr = JSON.parse(DeepSeekAndroid.mirrorDump())
    var s = JSON.parse(arr[0][1])
    return JSON.stringify({ root: s.rootMessageId, first: s.messages[0].id, last: s.messages[s.messages.length - 1].id, links: s.messages.map(function (m) { return m.id + '<-' + m.parentId }).join(' ') })
  })()`),
)
w.close()
