// 会话深度合并的单元测试。
// 运行：node --experimental-transform-types --no-warnings --import ./rust/register-ts.mjs scripts/test-merge-sessions.mjs
const { mergeSessionDeep } = await import(new URL('../src/services/chat/mergeSessions.ts', import.meta.url).href)

const msg = (id, createdAt, role = 'user', extra = {}) => ({ id, role, content: id, createdAt, ...(role === 'user' ? { files: [] } : {}), ...extra })

const local = {
  id: 's1',
  title: '我改过的标题',
  createdAt: 100,
  updatedAt: 900,
  messages: [msg('m1', 110), msg('m2', 120, 'assistant'), msg('m3', 500)],
  rootMessageId: 'm1',
  anchor: { text: '本地锚点', upTo: 'm2', createdAt: 300 },
}

const incoming = {
  id: 's1',
  title: '归档旧标题',
  createdAt: 1000,
  updatedAt: 1500,
  messages: [msg('m1', 110), msg('m2', 120, 'assistant'), msg('m4', 130, 'assistant')],
  rootMessageId: 'gone',
}

const { session, stats } = mergeSessionDeep(local, incoming)

const checks = []
const eq = (name, actual, expected) => checks.push([name, JSON.stringify(actual) === JSON.stringify(expected), actual, expected])

eq('标题保留本地', session.title, '我改过的标题')
eq('createdAt 取较早', session.createdAt, 100)
eq('updatedAt 取较晚', session.updatedAt, 1500)
eq('消息顺序=归档顺序+本地独有', session.messages.map((m) => m.id), ['m1', 'm2', 'm4', 'm3'])
eq('同 id 保留本地对象', session.messages[2].id, 'm4')
eq('本地 anchor 未被覆盖', session.anchor?.text, '本地锚点')
eq('rootMessageId 失效时回退', session.rootMessageId, 'm1')
eq('stats', stats, { added: 1, kept: 2, localOnly: 1 })

let failed = 0
for (const [name, ok, actual, expected] of checks) {
  if (!ok) { failed += 1; console.log('  ✗', name, '  实际=', JSON.stringify(actual), ' 期望=', JSON.stringify(expected)) }
  else console.log('  ✓', name)
}

// 本地标题为空时应采用归档标题
const blank = mergeSessionDeep({ ...local, title: '   ' }, incoming)
console.log(blank.session.title === '归档旧标题' ? '  ✓ 本地标题为空时用归档标题' : '  ✗ 本地标题为空时用归档标题')
if (blank.session.title !== '归档旧标题') failed += 1

// 空会话合并不应炸
const empty = mergeSessionDeep({ id: 's2', title: '', createdAt: 0, updatedAt: 0, messages: [] }, { id: 's2', title: 'T', createdAt: 5, updatedAt: 5, messages: [msg('x', 5)] })
console.log(empty.session.messages.length === 1 && empty.session.rootMessageId === 'x' ? '  ✓ 空本地会话可合并' : '  ✗ 空本地会话可合并')
if (!(empty.session.messages.length === 1 && empty.session.rootMessageId === 'x')) failed += 1

console.log(failed === 0 ? '\n全部通过' : '\n失败 ' + failed + ' 项')
