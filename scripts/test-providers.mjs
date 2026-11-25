// 厂商预设与模型拉取的单元测试（fetch 用桩，不联网）。
// 运行：node --experimental-transform-types --no-warnings --import ./rust/register-ts.mjs scripts/test-providers.mjs
import {
  PROVIDERS,
  DEEPSEEK_BASE_URL,
  findProvider,
  normalizeBaseUrl,
  fetchProviderModels,
} from '../src/services/api/providers.ts'

let failed = 0
const check = (name, ok, extra = '') => {
  if (ok) {
    console.log('  ✓', name)
  } else {
    failed += 1
    console.log('  ✗', name, extra)
  }
}

// ── 预设表完整性 ────────────────────────────────────────────────────────────
check('预设数量 >= 32', PROVIDERS.length >= 32, String(PROVIDERS.length))
check(
  'id 唯一',
  new Set(PROVIDERS.map((p) => p.id)).size === PROVIDERS.length,
  `${new Set(PROVIDERS.map((p) => p.id)).size} vs ${PROVIDERS.length}`
)
check(
  'label 非空',
  PROVIDERS.every((p) => p.label.trim().length > 0)
)
check(
  'baseUrl 要么是合法 http(s)，要么为空（需自填）',
  PROVIDERS.every((p) => p.baseUrl === '' || /^https?:\/\//.test(p.baseUrl))
)
check(
  '为空的 baseUrl 都带 note 说明',
  PROVIDERS.filter((p) => p.baseUrl === '').every((p) => Boolean(p.note))
)
check('第一个是 DeepSeek 官方且等于默认地址', PROVIDERS[0].id === 'deepseek' && PROVIDERS[0].baseUrl === DEEPSEEK_BASE_URL)
check('findProvider 命中', findProvider('moonshot')?.label.includes('月之暗面') === true)
check('findProvider 未命中返回 undefined', findProvider('nope') === undefined)
// 用户点名的厂商都要在表里
const required = [
  'openai', 'anthropic', 'google', 'dashscope', 'zhipu', 'zhipu-intl', 'moonshot', 'siliconflow',
  'modelscope', 'openrouter', 'groq', 'mistral', 'hunyuan', 'qianfan', 'minimax', 'stepfun', 'yi',
  'baichuan', 'kunlun', 'nvidia', 'together', 'fireworks', 'cerebras', 'perplexity', 'xfyun',
  'sensetime', 'longcat', 'so360', 'amd', 'huggingface', 'cloudflare', 'atomgit', 'agnes',
]
const missing = required.filter((id) => !findProvider(id))
check('点名的 33 家都在表里', missing.length === 0, missing.join(','))

// ── normalizeBaseUrl ───────────────────────────────────────────────────────
check('去尾部斜杠', normalizeBaseUrl('https://a.com/v1/') === 'https://a.com/v1')
check('保留路径', normalizeBaseUrl('https://open.bigmodel.cn/api/paas/v4') === 'https://open.bigmodel.cn/api/paas/v4')
check('空串返回空串', normalizeBaseUrl('   ') === '')
check('非 http(s) 拒绝', normalizeBaseUrl('ftp://a.com') === '')
check('缺协议拒绝', normalizeBaseUrl('a.com/v1') === '')

// ── fetchProviderModels（fetch 桩）──────────────────────────────────────────
const stubFetch = (payload, status = 200) => {
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  })
}

stubFetch({ data: [{ id: 'b-model', owned_by: 'x' }, { id: 'a-model' }, { id: 'b-model' }] })
const list = await fetchProviderModels('https://a.com/v1/', 'key')
check('拉取并按 id 排序', list.map((m) => m.id).join(',') === 'a-model,b-model', JSON.stringify(list.map((m) => m.id)))
check('owned_by 透传', list[1].ownedBy === 'x')
check('去重', list.length === 2)

stubFetch({ data: ['plain-string-id'] })
check('兼容纯字符串数组', (await fetchProviderModels('https://a.com/v1', 'key'))[0]?.id === 'plain-string-id')

let threw = ''
try {
  stubFetch({ objects: [] })
  await fetchProviderModels('https://a.com/v1', 'key')
} catch (error) {
  threw = String(error.message)
}
check('形状不对时抛错', threw === 'unexpected response')

threw = ''
try {
  stubFetch({ data: [] }, 401)
  await fetchProviderModels('https://a.com/v1', 'key')
} catch (error) {
  threw = String(error.message)
}
check('HTTP 401 抛错', threw === 'HTTP 401')

threw = ''
try {
  await fetchProviderModels('', 'key')
} catch (error) {
  threw = String(error.message)
}
check('空 baseUrl 抛错', threw === 'invalid base url')

threw = ''
try {
  await fetchProviderModels('https://a.com/v1', '   ')
} catch (error) {
  threw = String(error.message)
}
check('空 Key 抛错', threw === 'missing api key')

console.log(failed === 0 ? '\n全部通过' : '\n失败 ' + failed + ' 项')
process.exit(failed === 0 ? 0 : 1)
