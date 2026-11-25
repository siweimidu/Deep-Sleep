// 高级设置：协议与端点覆盖的解析、按厂商记忆、恢复默认。
const store = new Map()
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
}

const {
  useSettings,
  setProvider,
  setProviderProtocol,
  setProviderEndpoint,
  resetAdvancedSettings,
  resolveChatTarget,
} = await import('../src/services/settings.ts')

let failed = 0
const eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    console.log('  ✓', name)
  } else {
    failed += 1
    console.log('  ✗', name, '实际=', JSON.stringify(actual), '期望=', JSON.stringify(expected))
  }
}

const state = () => useSettings.getState()

// 1. 默认：官方走 Anthropic、别家走 OpenAI 兼容
setProvider('deepseek')
eq('官方默认 Anthropic', resolveChatTarget(), {
  protocol: 'anthropic',
  baseUrl: 'https://api.deepseek.com/v1',
})
setProvider('csdn')
eq('第三方默认 OpenAI', resolveChatTarget(), {
  protocol: 'openai',
  baseUrl: 'https://api-ai.gitcode.com/v1',
})

// 2. 手动指定协议
setProviderProtocol('anthropic')
eq('手动指定 Anthropic', resolveChatTarget().protocol, 'anthropic')
eq('协议按厂商存下来', state().providerProtocol, 'anthropic')

// 3. 换到别家：协议要回到那家自己的设置（默认 auto）
setProvider('zhipu')
eq('换厂商后协议回到该家设置', state().providerProtocol, 'auto')
setProvider('csdn')
eq('切回来仍是 Anthropic', state().providerProtocol, 'anthropic')

// 4. 端点覆盖优先，并把 origin 同步给 Anthropic 通路
setProviderEndpoint('https://proxy.example.com/v1/chat/completions')
eq('端点覆盖生效', resolveChatTarget().baseUrl, 'https://proxy.example.com/v1/chat/completions')
eq('origin 跟着覆盖走', state().apiBaseUrl, 'https://proxy.example.com')
setProvider('zhipu')
eq('别家不受影响', state().providerEndpoint, '')
setProvider('csdn')
eq('切回来覆盖还在', state().providerEndpoint, 'https://proxy.example.com/v1/chat/completions')

// 5. 恢复默认
resetAdvancedSettings()
eq('协议回 auto', state().providerProtocol, 'auto')
eq('端点清空', state().providerEndpoint, '')
eq('解析回推导值', resolveChatTarget(), {
  protocol: 'openai',
  baseUrl: 'https://api-ai.gitcode.com/v1',
})
eq('origin 回到厂商地址', state().apiBaseUrl, 'https://api-ai.gitcode.com')

console.log(failed === 0 ? '全部通过' : `失败 ${failed} 项`)
process.exit(failed === 0 ? 0 : 1)
