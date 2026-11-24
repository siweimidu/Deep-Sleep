// 自定义 API 地址的单元测试。
// 运行：node --experimental-transform-types --no-warnings --import ./rust/record-shim.mjs --import ./rust/register-ts.mjs scripts/test-endpoint.mjs
// record-shim 提供 __API_ORIGIN__，与构建期一致。
import { normalizeOrigin, isCustomOrigin } from '../src/services/api/endpoint.ts'
import { setOriginOverride } from '../src/services/api/originStore.ts'
import { apiOrigin, API_ORIGIN } from '../src/services/api/client.ts'

let failed = 0
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failed += 1
    console.log('  ✗', name, '实际=', JSON.stringify(actual), '期望=', JSON.stringify(expected))
  } else {
    console.log('  ✓', name)
  }
}

eq('正常 https', normalizeOrigin('https://example.com'), 'https://example.com')
eq('去掉路径', normalizeOrigin('https://example.com/v1/chat'), 'https://example.com')
eq('去掉尾部斜杠', normalizeOrigin('https://example.com/'), 'https://example.com')
eq('保留端口', normalizeOrigin('http://127.0.0.1:8080/v1'), 'http://127.0.0.1:8080')
eq('去掉账号密码', normalizeOrigin('https://user:pass@example.com/x'), 'https://example.com')
eq('空串=内置', normalizeOrigin('   '), null)
eq('非法', normalizeOrigin('not a url'), null)
eq('非 http(s)', normalizeOrigin('file:///etc/passwd'), null)
eq('ftp 拒绝', normalizeOrigin('ftp://example.com'), null)
eq('相同不算自定义', isCustomOrigin(API_ORIGIN, API_ORIGIN), false)
eq('不同算自定义', isCustomOrigin('https://x.com', API_ORIGIN), true)
eq('null 不算自定义', isCustomOrigin(null, API_ORIGIN), false)

// 真正的关键断言：覆盖值必须影响客户端实际使用的地址
eq('默认用内置', apiOrigin(), API_ORIGIN)
setOriginOverride('https://custom.example')
eq('覆盖后生效', apiOrigin(), 'https://custom.example')
eq('清理后回内置', (setOriginOverride(null), apiOrigin()), API_ORIGIN)

console.log(failed === 0 ? '\n全部通过' : '\n失败 ' + failed + ' 项')
process.exit(failed === 0 ? 0 : 1)
