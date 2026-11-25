/**
 * 第三方模型厂商预设与模型列表拉取。
 *
 * 设计取舍：
 *   1. `baseUrl` 是**完整**的 OpenAI 兼容前缀（带 `/v1` 之类），因为各家的版本段不统一
 *      （智谱是 `/api/paas/v4`、Groq 是 `/openai/v1`、Cloudflare 还带账号 id），
 *      只存主机名再拼 `/v1` 一定会错。
 *   2. 拿不准的厂商**留空字符串**并给出 note，而不是编一个看起来合理的地址——
 *      用户填错地址会得到"连不上"，而我编错会得到"这个应用骗我"。
 *   3. 拉模型只认 OpenAI 的 `{ data: [{ id }] }` 形状；其它形状一律当失败，宁可让用户手填模型名。
 */

export type ProviderPreset = {
  id: string
  /** 界面显示名 */
  label: string
  /** 完整 OpenAI 兼容 base url；空串表示需要用户自己填 */
  baseUrl: string
  /** 给用户的补充说明（例如需要账号 ID、需要自填地址） */
  note?: string
}

/** DeepSeek 官方地址：默认值，也是"不切换第三方"时的等价配置 */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'

export const PROVIDERS: ProviderPreset[] = [
  { id: 'deepseek', label: 'DeepSeek（官方）', baseUrl: DEEPSEEK_BASE_URL },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  {
    id: 'google',
    label: 'Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    note: '需要代理',
  },
  { id: 'dashscope', label: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'zhipu', label: '智谱 AI（国内版）', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'zhipu-intl', label: '智谱 AI（国际版）', baseUrl: 'https://api.z.ai/api/paas/v4' },
  { id: 'moonshot', label: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1' },
  { id: 'modelscope', label: '魔搭 ModelScope', baseUrl: 'https://api-inference.modelscope.cn/v1' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'hunyuan', label: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1' },
  { id: 'qianfan', label: '百度千帆', baseUrl: 'https://qianfan.baidubce.com/v2' },
  { id: 'minimax', label: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1' },
  { id: 'stepfun', label: '阶跃星辰', baseUrl: 'https://api.stepfun.com/v1' },
  { id: 'yi', label: '零一万物', baseUrl: 'https://api.lingyiwanwu.com/v1' },
  { id: 'baichuan', label: '百川智能', baseUrl: 'https://api.baichuan-ai.com/v1' },
  {
    id: 'kunlun',
    label: '昆仑万维 / 天工',
    baseUrl: 'https://api.tiangong.cn/v1',
    note: '地址以官方文档为准，可能已更换域名',
  },
  { id: 'nvidia', label: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1' },
  { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'fireworks', label: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1' },
  { id: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1' },
  { id: 'perplexity', label: 'Perplexity', baseUrl: 'https://api.perplexity.ai' },
  { id: 'xfyun', label: '科大讯飞星火', baseUrl: 'https://spark-api-open.xf-yun.com/v1' },
  { id: 'sensetime', label: '商汤 MIMO', baseUrl: 'https://api.sensenova.cn/compatible-mode/v1' },
  {
    id: 'longcat',
    label: '美团 LongCat',
    baseUrl: 'https://api.longcat.chat/openai/v1',
    note: '地址以官方文档为准',
  },
  { id: 'so360', label: '360 智脑', baseUrl: 'https://api.360.cn/v1', note: '地址以官方文档为准' },
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    baseUrl: '',
    note: '需填 https://api.cloudflare.com/client/v4/accounts/<账号ID>/ai/v1',
  },
  { id: 'huggingface', label: 'Hugging Face', baseUrl: 'https://router.huggingface.co/v1' },
  { id: 'amd', label: 'AMD', baseUrl: '', note: '请填写官方 OpenAI 兼容地址' },
  { id: 'atomgit', label: 'AtomGit', baseUrl: '', note: '请填写官方 OpenAI 兼容地址' },
  { id: 'agnes-intl', label: 'Agnes（国际）', baseUrl: 'https://apihub.agnes-ai.com/v1' },
  { id: 'agnes-cn', label: 'Agnes（中国）', baseUrl: 'https://api.agnes-ai.cn/v1' },
  { id: 'csdn', label: 'CSDN（GitCode）', baseUrl: 'https://api-ai.gitcode.com/v1' },
]

export const findProvider = (id: string): ProviderPreset | undefined =>
  PROVIDERS.find((provider) => provider.id === id)

/**
 * 规范化用户输入：去掉尾部斜杠，允许只填主机名（补 `/v1`）。
 * 空串返回空串，由调用方决定如何处理。
 */
export const normalizeBaseUrl = (raw: string): string => {
  const value = (raw ?? '').trim().replace(/\/+$/, '')
  if (!value) {
    return ''
  }
  if (!/^https?:\/\//i.test(value)) {
    return ''
  }
  return value
}

export type RemoteModel = { id: string; ownedBy?: string }

/**
 * 用当前 baseUrl + API Key 拉模型列表。
 *
 * 各家实现细节不一：有的返回 `{ data: [...] }`、有的 `owned_by` 缺失、有的混入非对话模型。
 * 这里只做"挑出 id"这一件事，过滤与排序规则写死，出问题好定位。
 */
/**
 * 带超时的 fetch。连不通的域名往往既不返回也不拒绝（被黑洞掉），
 * 不设超时界面就会永远停在「正在获取模型…」。
 */
export const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs = 20000
): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const relay = () => controller.abort()
  init.signal?.addEventListener('abort', relay, { once: true })
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted) {
      throw new Error('request timed out')
    }
    throw error
  } finally {
    clearTimeout(timer)
    init.signal?.removeEventListener('abort', relay)
  }
}

export const fetchProviderModels = async (
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<RemoteModel[]> => {
  const root = normalizeBaseUrl(baseUrl)
  if (!root) {
    throw new Error('invalid base url')
  }
  if (!apiKey.trim()) {
    throw new Error('missing api key')
  }
  const response = await fetchWithTimeout(`${root}/models`, {
    method: 'GET',
    headers: { authorization: `Bearer ${apiKey.trim()}`, accept: 'application/json' },
    signal,
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const body: unknown = await response.json()
  const data = (body as { data?: unknown })?.data
  if (!Array.isArray(data)) {
    throw new Error('unexpected response')
  }
  const seen = new Set<string>()
  const models: RemoteModel[] = []
  for (const entry of data) {
    const id = typeof entry === 'string' ? entry : (entry as { id?: unknown })?.id
    if (typeof id !== 'string' || !id || seen.has(id)) {
      continue
    }
    seen.add(id)
    const ownedBy = (entry as { owned_by?: unknown })?.owned_by
    models.push({ id, ownedBy: typeof ownedBy === 'string' ? ownedBy : undefined })
  }
  models.sort((left, right) => left.id.localeCompare(right.id))
  return models
}
