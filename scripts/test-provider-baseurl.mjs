// 回归：旧的全局 base url 不能带到新厂商头上，否则官方通路会去请求别家的域名，
// 界面上表现成"网络异常"（真机上就是这么炸的）。
const store = new Map()
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
}

// 模拟老数据：厂商是官方 DeepSeek，但地址还是上一家 CSDN 留下的
store.set('replica:provider-id', 'deepseek')
store.set('replica:provider-base-url', 'https://api-ai.gitcode.com/v1')
store.set('replica:api-base-url', 'https://api-ai.gitcode.com')

const { useSettings, setProvider, setProviderBaseUrl } = await import(
  '../src/services/settings.ts'
)

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

const state = () => useSettings.getState()

// 1. 启动时把外来域名丢掉，回到预置
eq('别家的地址不会带到官方头上', state().providerBaseUrl, 'https://api.deepseek.com/v1')
eq('厂商仍是官方', state().providerId, 'deepseek')
// Anthropic 通路用的是另一份 origin，同样不能留着上一家的域名
eq('Anthropic 通路的 origin 也跟着对齐', state().apiBaseUrl, 'https://api.deepseek.com')

// 2. 用户手填地址：要记住，且按厂商分别记
setProviderBaseUrl('https://my.proxy.example/v1')
eq('手填地址立即生效', state().providerBaseUrl, 'https://my.proxy.example/v1')
eq(
  '手填地址按厂商存下来',
  JSON.parse(store.get('replica:provider-base-url-by-id') || '{}').deepseek,
  'https://my.proxy.example/v1'
)

// 3. 切到别家再切回来：不会串地址
setProvider('csdn')
eq('切到 CSDN 用它的地址', state().providerBaseUrl, 'https://api-ai.gitcode.com/v1')
eq(
  'CSDN 的地址单独存一份',
  JSON.parse(store.get('replica:provider-base-url-by-id') || '{}').csdn,
  'https://api-ai.gitcode.com/v1'
)
setProvider('deepseek')
eq('切回官方用官方地址', state().providerBaseUrl, 'https://api.deepseek.com/v1')

console.log(failed === 0 ? '全部通过' : `失败 ${failed} 项`)
process.exit(failed === 0 ? 0 : 1)
