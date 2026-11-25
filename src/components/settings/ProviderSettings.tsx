import { useState } from 'react'
import {
  PROVIDERS,
  DEEPSEEK_BASE_URL,
  findProvider,
  fetchProviderModels,
  normalizeBaseUrl,
  type RemoteModel,
} from '../../services/api/providers.js'
import { streamOpenAiChat } from '../../services/api/openaiChat.js'
import {
  setProvider,
  setProviderBaseUrl,
  setProviderModel,
  toggleSavedModel,
  useSettings,
} from '../../services/settings.js'
import styles from './ProviderSettings.module.css'

/**
 * 第三方模型设置页。
 *
 * 版式对齐 DeepSeek 官方平台的 API 配置页：字段标签在上、下方是深色输入区、
 * 模型用 chips 展示、高级项折叠、底部两个胶囊测试按钮。用项目已有的设计 token 落地，
 * 所以深色/浅色主题都跟着走。
 */
export const ProviderSettings = () => {
  const providerId = useSettings((state) => state.providerId)
  const providerBaseUrl = useSettings((state) => state.providerBaseUrl)
  const providerModel = useSettings((state) => state.providerModel)
  const savedModels = useSettings((state) => state.savedModels)
  const apiKey = useSettings((state) => state.apiKey)
  const locale = useSettings((state) => (state as { locale?: string }).locale ?? 'zh')
  const tr = (zh: string, en: string) => (locale === 'en' ? en : zh)

  const [reveal, setReveal] = useState(false)
  const [models, setModels] = useState<RemoteModel[]>([])
  const [busy, setBusy] = useState<'models' | 'conn' | 'perf' | ''>('')
  const [status, setStatus] = useState('')
  const [advanced, setAdvanced] = useState(false)

  const preset = findProvider(providerId)
  const isDeepSeek = providerId === 'deepseek'

  const loadModels = async (report: (text: string) => void) => {
    setBusy('models')
    report(tr('正在获取模型…', 'Fetching models…'))
    try {
      const list = await fetchProviderModels(providerBaseUrl, apiKey ?? '')
      setModels(list)
      report(
        list.length
          ? tr(`获取到 ${list.length} 个模型`, `${list.length} models found`)
          : tr('没有返回任何模型', 'No models returned')
      )
    } catch (error) {
      report(tr('获取失败：', 'Failed: ') + describe(error))
    } finally {
      setBusy('')
    }
  }

  const describe = (error: unknown): string => {
    const text = error instanceof Error ? error.message : String(error)
    if (text === 'invalid base url') {
      return tr('Base URL 不合法（需要 http(s):// 开头）', 'Invalid base URL')
    }
    if (text === 'missing api key') {
      return tr('请先填写 API Key', 'API key required')
    }
    if (text.startsWith('HTTP 401')) {
      return tr('API Key 无效或没有权限（401）', 'Invalid key or no permission (401)')
    }
    if (text.startsWith('HTTP 403')) {
      return tr('该 Key 无权访问此模型（403）', 'Key cannot access this model (403)')
    }
    if (text.startsWith('HTTP 404')) {
      return tr('接口地址不存在（404），检查 Base URL 是否带 /v1', 'Endpoint not found (404)')
    }
    if (text === 'unexpected response') {
      return tr('返回格式不是 OpenAI 兼容格式', 'Response is not OpenAI-compatible')
    }
    return text
  }

  const testConnection = async () => {
    setBusy('conn')
    setStatus(tr('正在测试连接…', 'Testing connection…'))
    const started = performance.now()
    try {
      const list = await fetchProviderModels(providerBaseUrl, apiKey ?? '')
      const ms = Math.round(performance.now() - started)
      setModels(list)
      setStatus(tr(`连接正常 · ${list.length} 个模型 · ${ms}ms`, `OK · ${list.length} models · ${ms}ms`))
    } catch (error) {
      setStatus(tr('连接失败：', 'Failed: ') + describe(error))
    } finally {
      setBusy('')
    }
  }

  const testPerformance = async () => {
    const model = providerModel ?? models[0]?.id ?? ''
    if (!model) {
      setStatus(tr('先选一个模型再测性能', 'Pick a model first'))
      return
    }
    setBusy('perf')
    setStatus(tr('正在测首字延迟…', 'Measuring first-token latency…'))
    const started = performance.now()
    try {
      await streamOpenAiChat({
        baseUrl: providerBaseUrl,
        apiKey: apiKey ?? '',
        model,
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 1,
      })
      const ms = Math.round(performance.now() - started)
      setStatus(tr(`首字延迟约 ${ms}ms（模型 ${model}）`, `First token ~${ms}ms (${model})`))
    } catch (error) {
      setStatus(tr('性能测试失败：', 'Failed: ') + describe(error))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <span className={styles.label}>{tr('配置名称', 'Profile')}</span>
        <div className={styles.value}>{preset?.label ?? providerId}</div>
      </section>

      <section className={styles.section}>
        <span className={styles.label}>{tr('模型厂商', 'Provider')}</span>
        <select
          className={styles.field}
          value={providerId}
          onChange={(event) => {
            setProvider(event.target.value)
            setModels([])
            setStatus('')
          }}
        >
          {PROVIDERS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
              {item.baseUrl ? '' : tr('（需自填地址）', ' (enter URL)')}
            </option>
          ))}
        </select>
        {preset?.note ? <p className={styles.note}>{preset.note}</p> : null}
      </section>

      <section className={styles.section}>
        <span className={styles.label}>API Key</span>
        <div className={styles.row}>
          <input
            className={styles.field}
            type={reveal ? 'text' : 'password'}
            value={apiKey ?? ''}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => useSettings.setState({ apiKey: event.target.value })}
          />
          <button
            type="button"
            className={styles.ghost}
            aria-label={reveal ? tr('隐藏', 'Hide') : tr('显示', 'Show')}
            onClick={() => setReveal((value) => !value)}
          >
            {reveal ? '🙈' : '👁'}
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <span className={styles.label}>Base URL</span>
        <input
          className={styles.field}
          value={providerBaseUrl}
          autoComplete="off"
          spellCheck={false}
          placeholder={DEEPSEEK_BASE_URL}
          onChange={(event) => setProviderBaseUrl(event.target.value)}
        />
        <p className={styles.note}>
          {tr('填写完整 API Base URL，例如 ', 'Full API base URL, e.g. ')}
          {DEEPSEEK_BASE_URL}
        </p>
      </section>

      <section className={styles.section}>
        <span className={styles.label}>{tr('模型名称', 'Model')}</span>
        <div className={styles.row}>
          <input
            className={styles.field}
            value={providerModel ?? ''}
            autoComplete="off"
            spellCheck={false}
            placeholder={tr('例如 deepseek-chat', 'e.g. deepseek-chat')}
            onChange={(event) => setProviderModel(event.target.value)}
          />
          <button
            type="button"
            className={styles.ghost}
            disabled={busy !== ''}
            onClick={() => void loadModels(setStatus)}
          >
            {busy === 'models' ? '…' : tr('获取模型', 'Fetch')}
          </button>
        </div>
        {models.length > 0 ? (
          <div className={styles.chips}>
            {models.slice(0, 40).map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.chip}
                data-active={providerModel === item.id ? '' : undefined}
                onClick={() => setProviderModel(item.id)}
              >
                {item.id}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className={styles.section}>
        <div className={styles.row}>
          <span className={styles.label}>
            {tr('已保存的模型', 'Saved models')} {savedModels.length}
          </span>
          <button
            type="button"
            className={styles.pill}
            disabled={!providerModel}
            onClick={() => providerModel && toggleSavedModel(providerModel)}
          >
            + {tr('保存当前模型', 'Save current')}
          </button>
        </div>
        {savedModels.length > 0 ? (
          <div className={styles.chips}>
            {savedModels.map((item) => (
              <button
                key={item}
                type="button"
                className={styles.chip}
                data-active={providerModel === item ? '' : undefined}
                onClick={() => setProviderModel(item)}
                onDoubleClick={() => toggleSavedModel(item)}
                title={tr('双击移除', 'Double-click to remove')}
              >
                {item} <span className={styles.trash}>⌫</span>
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.note}>{tr('还没有保存的模型', 'Nothing saved yet')}</p>
        )}
      </section>

      <section className={styles.section}>
        <button type="button" className={styles.advanced} onClick={() => setAdvanced((value) => !value)}>
          {tr('API 高级设置', 'Advanced')}
          <span data-open={advanced ? '' : undefined}>⌄</span>
        </button>
        {advanced ? (
          <div className={styles.advancedBody}>
            <p className={styles.note}>
              {tr(
                '内置 30+ 国内外厂商预设。厂商地址留空的，需要按官方文档自行填写完整 Base URL。',
                '30+ providers are preset. Where the URL is blank, fill it in from the provider docs.'
              )}
            </p>
            <button
              type="button"
              className={styles.ghost}
              onClick={() => {
                setProvider('deepseek')
                setProviderBaseUrl(DEEPSEEK_BASE_URL)
                setStatus(tr('已恢复官方地址', 'Restored official URL'))
              }}
            >
              {tr('恢复 DeepSeek 官方地址', 'Reset to DeepSeek')}
            </button>
          </div>
        ) : null}
      </section>

      <div className={styles.actions}>
        <button type="button" className={styles.pill} disabled={busy !== ''} onClick={() => void testConnection()}>
          ⚡ {tr('测试模型连接', 'Test connection')}
        </button>
        <button type="button" className={styles.pill} disabled={busy !== ''} onClick={() => void testPerformance()}>
          ◠ {tr('测试模型性能', 'Test performance')}
        </button>
      </div>

      {status ? (
        <p className={styles.status} role="status">
          {status}
        </p>
      ) : null}

      {!isDeepSeek && !normalizeBaseUrl(providerBaseUrl) ? (
        <p className={styles.warn}>{tr('Base URL 无效，无法请求。', 'Base URL is invalid.')}</p>
      ) : null}
    </div>
  )
}
