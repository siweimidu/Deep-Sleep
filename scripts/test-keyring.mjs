// 钥匙串与"这把 Key 还能不能用"的单元测试。
// 运行：node --experimental-transform-types --no-warnings --import ./rust/register-ts.mjs scripts/test-keyring.mjs
import {
  activeKeyOf,
  activeIndexOf,
  addKey,
  emptyKeyring,
  hasAnyKey,
  isKeyUnusable,
  keysOf,
  maskKey,
  parseKeyring,
  removeKey,
  replaceActiveKey,
  rotateKey,
  selectKey,
  serializeKeyring,
} from '../src/services/api/keyring.ts'

let failed = 0
const check = (name, ok, extra = '') => {
  if (ok) console.log('  ✓', name)
  else {
    failed += 1
    console.log('  ✗', name, extra)
  }
}

// 解析与迁移
check('空值得到空钥匙串', keysOf(parseKeyring(null, 'deepseek'), 'deepseek').length === 0)
const legacy = parseKeyring('sk-legacy-123', 'agnes-cn')
check('裸 Key 迁到当前厂商', activeKeyOf(legacy, 'agnes-cn') === 'sk-legacy-123')
check('迁移后别家仍是空', keysOf(legacy, 'deepseek').length === 0)
check('坏 JSON 不炸也不丢', keysOf(parseKeyring('{oops', 'deepseek'), 'deepseek').length === 0)
const roundTrip = parseKeyring(serializeKeyring(legacy), 'x')
check('序列化往返一致', activeKeyOf(roundTrip, 'agnes-cn') === 'sk-legacy-123')
const badActive = parseKeyring(JSON.stringify({ keys: { a: ['k1', 'k2'] }, active: { a: 9 } }), 'a')
check('越界的 active 夹回 0', activeIndexOf(badActive, 'a') === 0)

// 增删选
let ring = emptyKeyring()
ring = addKey(ring, 'google', 'k-one')
ring = addKey(ring, 'google', 'k-two')
check('追加两把', keysOf(ring, 'google').length === 2)
check('新加的成为在用', activeKeyOf(ring, 'google') === 'k-two')
ring = addKey(ring, 'google', 'k-one')
check('重复的不再加', keysOf(ring, 'google').length === 2)
check('重复添加会把它在用', activeKeyOf(ring, 'google') === 'k-one')
ring = selectKey(ring, 'google', 'k-two')
check('可以指定用哪把', activeKeyOf(ring, 'google') === 'k-two')
ring = removeKey(ring, 'google', 'k-two')
check('删掉在用那把后仍有一把在用', activeKeyOf(ring, 'google') === 'k-one')
ring = removeKey(ring, 'google', 'k-one')
check('删光后这家消失', keysOf(ring, 'google').length === 0 && !hasAnyKey(ring))

// 轮换
let rotate = emptyKeyring()
rotate = addKey(rotate, 'x', 'a')
rotate = addKey(rotate, 'x', 'b')
rotate = addKey(rotate, 'x', 'c')
rotate = selectKey(rotate, 'x', 'a')
const seq = []
for (let step = 0; step < 4; step += 1) {
  seq.push(activeKeyOf(rotate, 'x'))
  rotate = rotateKey(rotate, 'x')
}
check('轮换按顺序绕回', seq.join(',') === 'a,b,c,a', seq.join(','))
const single = addKey(emptyKeyring(), 'y', 'only')
check('只有一把时不轮换', activeKeyOf(rotateKey(single, 'y'), 'y') === 'only')

// 替换在用那把
let replaced = addKey(addKey(emptyKeyring(), 'z', 'old1'), 'z', 'old2')
replaced = selectKey(replaced, 'z', 'old1')
const afterReplace = replaceActiveKey(replaced, 'z', 'new1')
check('替换只动在用的那把', keysOf(afterReplace, 'z').join(',') === 'new1,old2', keysOf(afterReplace, 'z').join(','))
check('替换后新的在用', activeKeyOf(afterReplace, 'z') === 'new1')

// 展示（用合成的串，真 Key 一律不进仓库）
const sample = 'sk-0123456789abcdefghijklmnopqrstuvwxyzABCDEF'
check('掩码只露头尾', maskKey(sample) === 'sk-…CDEF', maskKey(sample))
check('短串不泄露', maskKey('short') === '••••')

// 哪些错误值得换 Key
const withStatus = (status) => Object.assign(new Error('nope'), { status })
check('401 换', isKeyUnusable(withStatus(401)))
check('402 换', isKeyUnusable(withStatus(402)))
check('403 换', isKeyUnusable(withStatus(403)))
check('429 换', isKeyUnusable(withStatus(429)))
check('400 不换', !isKeyUnusable(withStatus(400)))
check('404 不换', !isKeyUnusable(withStatus(404)))
check('500 不换', !isKeyUnusable(withStatus(500)))
check('额度字样也换', isKeyUnusable(new Error('You exceeded your current quota')))
check('余额字样也换', isKeyUnusable(new Error('账户余额不足')))
check('普通网络错不换', !isKeyUnusable(new Error('Failed to fetch')))

console.log(failed === 0 ? '\n全部通过' : '\n失败 ' + failed + ' 项')
process.exit(failed === 0 ? 0 : 1)
