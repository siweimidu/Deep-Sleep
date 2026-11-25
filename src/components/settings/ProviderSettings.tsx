import { useState, type ReactNode } from 'react'
import { IconChevronRightOutline14, IconCheckOutline16 } from '../base/icons.js'
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
  addProviderKey,
  removeProviderKey,
  selectProviderKey,
  setProvider,
  setProviderBaseUrl,
  setProviderModel,
  toggleSavedModel,
  useSettings,
  withKeyRotation,
} from '../../services/settings.js'
import { maskKey } from '../../services/api/keyring.js'
import settingsStyles from './AndroidSettings.module.css'
import styles from './ProviderSettings.module.css'

/**
 * 第三方模型设置。
 *
 * 版式跟官方 **APP** 对齐，而不是跟网页控制台对齐：设置页是「分组卡片 + 行」的结构，
 * 点一行展开编辑区，和「字体大小 / 个性化」那些页面同一种语言。
 * 结构类直接复用 AndroidSettings.module.css（group / card / row / rowLabel / arrow / caption），
 * 保证与设置里其它页完全一致；只有输入框、chips、状态条用本模块自己的样式。
 */
const Row = ({
  label,
  value,
  onClick,
  active,
}: {
  label: string
  value: ReactNode
  onClick?: () => void
  active?: boolean
}) => (
  <button type="button" className={settingsStyles.row} data-active={active ? '' : undefined} onClick={onClick}>
    <span className={settingsStyles.rowLabel}>{label}</span>
    <span className={styles.rowValue}>{value}</span>
    <span className={settingsStyles.arrow}>
      <IconChevronRightOutline14 />
    </span>
  </button>
)

export const ProviderSettings = () => {
  const providerId = useSettings((state) => state.providerId)
  const providerBaseUrl = useSettings((state) => state.providerBaseUrl)
  const providerModel = useSettings((state) => state.providerModel)
  const savedModels = useSettings((state) => state.savedModels)
  const apiKey = useSettings((state) => state.apiKey)
  const providerKeys = useSettings((state) => state.providerKeys)
  const locale = useSettings((state) => (state as { locale?: string }).locale ?? 'zh')
  const tr = (zh: string, en: string) => (locale === 'en' ? en : zh)

  const [open, setOpen] = useState<'' | 'provider' | 'key' | 'url' | 'model'>('')
  const [reveal, setReveal] = useState(false)
  const [models, setModels] = useState<RemoteModel[]>([])
  const [busy, setBusy] = useState<'models' | 'conn' | 'perf' | ''>('')
  const [status, setStatus] = useState('')
  // 测速结果单独放：它要显示在那一行右侧，混进底部状态栏用户看不到
  const [speed, setSpeed] = useState('')
  // Key 用草稿：存盘要过 AndroidKeyStore 加密，逐字符写既慢又会让 store 出现空值，
  // 而 store 一空主界面就会切到首次引导页。
  const [keyDraft, setKeyDraft] = useState('')

  const commitKey = (): void => {
    const next = keyDraft.trim()
    // 空草稿不落盘：清空输入框再失焦就把 Key 删掉太容易误伤。要删请点 Key 上的 ×。
    if (!next) {
      return
    }
    if (!addProviderKey(next)) {
      setStatus(tr('API Key 保存失败', 'Could not save the key'))
      return
    }
    setKeyDraft('')
  }

  const preset = findProvider(providerId)
  const toggle = (section: typeof open) => setOpen((current) => (current === section ? '' : section))

  const describe = (error: unknown): string => {
    const text = error instanceof Error ? error.message : String(error)
    if (text === 'invalid base url') {
      return tr('Base URL 不合法', 'Invalid base URL')
    }
    if (text === 'missing api key') {
      return tr('请先填写 API Key', 'API key required')
    }
    if (text.startsWith('HTTP 401')) {
      return tr('API Key 无效或无权限（401）', 'Invalid key (401)')
    }
    if (text.startsWith('HTTP 402')) {
      return tr('余额不足，充值后再试（402）', 'Out of credit (402)')
    }
    if (text.startsWith('HTTP 429')) {
      return tr('请求太频繁或已限流（429）', 'Rate limited (429)')
    }
    if (text.startsWith('HTTP 5')) {
      return tr('对方服务端出错，稍后再试', 'Vendor server error')
    }
    if (text.startsWith('HTTP 403')) {
      return tr('该 Key 无权访问（403）', 'No access (403)')
    }
    if (text.startsWith('HTTP 404')) {
      return tr('接口不存在（404），检查是否少了 /v1', 'Not found (404)')
    }
    if (text === 'unexpected response') {
      return tr('不是 OpenAI 兼容格式', 'Not OpenAI-compatible')
    }
    if (text === 'request timed out') {
      return tr('请求超时：连不上这个地址，检查网络或代理', 'Timed out — check the network or proxy')
    }
    if (/failed to fetch|networkerror|load failed/i.test(text)) {
      return tr('连不上这个地址，检查网络或代理', 'Cannot reach this address')
    }
    return text
  }

  const loadModels = async () => {
    commitKey()
    setBusy('models')
    setStatus(tr('正在获取模型…', 'Fetching…'))
    try {
      // 这一家的 Key 用不了就自动换下一把
      const list = await withKeyRotation(providerId, (key) => fetchProviderModels(providerBaseUrl, key))
      setModels(list)
      setStatus(list.length ? tr(`${list.length} 个模型可用`, `${list.length} models`) : tr('没有返回模型', 'No models'))
    } catch (error) {
      setStatus(tr('获取失败：', 'Failed: ') + describe(error))
    } finally {
      setBusy('')
    }
  }

  const testConnection = async () => {
    commitKey()
    setBusy('conn')
    setStatus(tr('正在测试连接…', 'Testing…'))
    const started = performance.now()
    try {
      const list = await withKeyRotation(providerId, (key) => fetchProviderModels(providerBaseUrl, key))
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
      setStatus(tr('先选一个模型', 'Pick a model first'))
      return
    }
    setBusy('perf')
    setStatus(tr('正在测速…', 'Measuring…'))
    commitKey()
    // 测「速度」要量首个增量到最后一个增量的区间：把建连和首字等待扣掉，
    // 否则连一个只会吐 20 个 token 的模型都能被测成很慢。
    let firstAt = 0
    let lastAt = 0
    let chars = 0
    try {
      const result = await streamOpenAiChat(
        {
          baseUrl: providerBaseUrl,
          apiKey: useSettings.getState().apiKey ?? '',
          model,
          messages: [{ role: 'user', content: '数到二十，用中文数字，只输出数字。' }],
          maxTokens: 200,
          includeUsage: true,
        },
        (delta) => {
          const now = performance.now()
          firstAt ||= now
          lastAt = now
          chars += delta.text.length + delta.reasoning.length
        }
      )
      const seconds = (lastAt - firstAt) / 1000
      const tokens = result.usage?.completionTokens ?? 0
      setStatus('')
      if (tokens > 0 && seconds > 0.05) {
        setSpeed(
          tr(
            `约 ${(tokens / seconds).toFixed(1)} tok/s · ${tokens} tokens / ${seconds.toFixed(1)}s`,
            `~${(tokens / seconds).toFixed(1)} tok/s · ${tokens} tokens / ${seconds.toFixed(1)}s`
          )
        )
      } else if (chars > 0 && seconds > 0.05) {
        // 厂商不回 usage：按字符粗估，必须标明是估算，不能假装是实测 token 数
        const estimate = chars / 1.7
        setSpeed(
          tr(
            `约 ${(estimate / seconds).toFixed(1)} tok/s（估算）· ${chars} 字符 / ${seconds.toFixed(1)}s`,
            `~${(estimate / seconds).toFixed(1)} tok/s (est.) · ${chars} chars / ${seconds.toFixed(1)}s`
          )
        )
      } else {
        setSpeed(tr('没吐内容，测不出', 'Nothing to measure'))
      }
    } catch (error) {
      setStatus(tr('测速失败：', 'Failed: ') + describe(error))
    } finally {
      setBusy('')
    }
  }

  const host = providerBaseUrl.replace(/^https?:\/\//, '').split('/')[0] || tr('未填写', 'not set')

  return (
    <div className={styles.page}>
      <section className={settingsStyles.group}>
        <div className={settingsStyles.card}>
          <Row
            label={tr('模型厂商', 'Provider')}
            value={preset?.label ?? providerId}
            active={open === 'provider'}
            onClick={() => toggle('provider')}
          />
          {open === 'provider' ? (
            <div className={styles.editor}>
              {PROVIDERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.option}
                  data-current={item.id === providerId ? '' : undefined}
                  onClick={() => {
                    setProvider(item.id)
                    setModels([])
                    setStatus('')
                    setOpen('')
                  }}
                >
                  <span>{item.label}</span>
                  {item.baseUrl ? null : <em className={styles.badge}>{tr('需自填', 'enter URL')}</em>}
                  {item.baseUrl && item.note ? <em className={styles.badge}>{item.note}</em> : null}
                  {item.id === providerId ? <IconCheckOutline16 /> : null}
                </button>
              ))}
            </div>
          ) : null}

          <Row
            label="API Key"
            value={
              providerKeys.length === 0
                ? tr('未设置', 'not set')
                : providerKeys.length === 1
                  ? maskKey(providerKeys[0] ?? '')
                  : tr(`${providerKeys.length} 把 · ${maskKey(apiKey ?? '')}`, `${providerKeys.length} keys`)
            }
            active={open === 'key'}
            onClick={() => {
              setKeyDraft('')
              toggle('key')
            }}
          />
          {open === 'key' ? (
            <div className={styles.editor}>
              {providerKeys.length > 0 ? (
                <div className={styles.chips}>
                  {providerKeys.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={styles.chip}
                      data-active={apiKey === item ? '' : undefined}
                      onClick={() => selectProviderKey(item)}
                    >
                      {maskKey(item)}
                      <span
                        className={styles.trash}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation()
                          removeProviderKey(item)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.stopPropagation()
                            removeProviderKey(item)
                          }
                        }}
                      >
                        ×
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className={styles.inline}>
                <input
                  className={styles.field}
                  type={reveal ? 'text' : 'password'}
                  value={keyDraft}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={tr('粘贴 API Key，可存多把', 'Paste a key; several allowed')}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      commitKey()
                    }
                  }}
                  onBlur={commitKey}
                />
                <button type="button" className={styles.ghost} onClick={() => setReveal((value) => !value)}>
                  {reveal ? tr('隐藏', 'Hide') : tr('显示', 'Show')}
                </button>
              </div>
              <p className={styles.hint}>
                {tr(
                  '同一家可以存多把，当前这把没额度时自动换下一把',
                  'Several keys per vendor; the next one is used when this one runs out'
                )}
              </p>
            </div>
          ) : null}

          <Row
            label="Base URL"
            value={host}
            active={open === 'url'}
            onClick={() => toggle('url')}
          />
          {open === 'url' ? (
            <div className={styles.editor}>
              <input
                className={styles.field}
                value={providerBaseUrl}
                autoComplete="off"
                spellCheck={false}
                placeholder={DEEPSEEK_BASE_URL}
                onChange={(event) => setProviderBaseUrl(event.target.value)}
              />
              <p className={styles.note}>
                {tr('填写完整地址，例如 ', 'Full URL, e.g. ')}
                {DEEPSEEK_BASE_URL}
                {preset?.note ? ' · ' + preset.note : ''}
              </p>
            </div>
          ) : null}

          <Row
            label={tr('模型', 'Model')}
            value={providerModel ?? tr('未选择', 'not set')}
            active={open === 'model'}
            onClick={() => toggle('model')}
          />
          {open === 'model' ? (
            <div className={styles.editor}>
              <div className={styles.inline}>
                <input
                  className={styles.field}
                  value={providerModel ?? ''}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={tr('模型名称，例如 deepseek-chat', 'Model name')}
                  onChange={(event) => setProviderModel(event.target.value)}
                />
                <button type="button" className={styles.ghost} disabled={busy !== ''} onClick={() => void loadModels()}>
                  {busy === 'models' ? '…' : tr('获取模型', 'Fetch')}
                </button>
              </div>
              {models.length > 0 ? (
                <div className={styles.chips}>
                  {models.map((item) => (
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
            </div>
          ) : null}
        </div>
      </section>

      <section className={settingsStyles.group}>
        <div className={settingsStyles.card}>
          <div className={settingsStyles.row}>
            <span className={settingsStyles.rowLabel}>{tr('已保存的模型', 'Saved models')}</span>
            <span className={styles.rowValue}>{savedModels.length}</span>
            <button
              type="button"
              className={styles.ghost}
              disabled={!providerModel}
              onClick={() => providerModel && toggleSavedModel(providerModel)}
            >
              + {tr('保存当前', 'Save')}
            </button>
          </div>
          {savedModels.length > 0 ? (
            <div className={styles.editor}>
              <div className={styles.chips}>
                {savedModels.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={styles.chip}
                    data-active={providerModel === item ? '' : undefined}
                    onClick={() => setProviderModel(item)}
                  >
                    {item}
                    <span
                      className={styles.trash}
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleSavedModel(item)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.stopPropagation()
                          toggleSavedModel(item)
                        }
                      }}
                    >
                      ×
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className={settingsStyles.group}>
        <div className={settingsStyles.card}>
          <Row
            label={tr('测试模型连接', 'Test connection')}
            value={busy === 'conn' ? tr('测试中…', 'testing…') : ''}
            onClick={() => void testConnection()}
          />
          <Row
            label={tr('测试模型速度', 'Test token speed')}
            value={busy === 'perf' ? tr('测试中…', 'testing…') : speed}
            onClick={() => void testPerformance()}
          />
        </div>
      </section>

      {status ? <p className={settingsStyles.caption}>{status}</p> : null}
      {providerId !== 'deepseek' && !normalizeBaseUrl(providerBaseUrl) ? (
        <p className={settingsStyles.caption}>{tr('Base URL 无效，无法请求。', 'Base URL is invalid.')}</p>
      ) : null}
    </div>
  )
}
