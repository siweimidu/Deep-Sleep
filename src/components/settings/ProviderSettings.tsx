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
  setApiKey,
  setProvider,
  setProviderBaseUrl,
  setProviderModel,
  toggleSavedModel,
  useSettings,
} from '../../services/settings.js'
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
  const locale = useSettings((state) => (state as { locale?: string }).locale ?? 'zh')
  const tr = (zh: string, en: string) => (locale === 'en' ? en : zh)

  const [open, setOpen] = useState<'' | 'provider' | 'key' | 'url' | 'model'>('')
  const [reveal, setReveal] = useState(false)
  const [models, setModels] = useState<RemoteModel[]>([])
  const [busy, setBusy] = useState<'models' | 'conn' | 'perf' | ''>('')
  const [status, setStatus] = useState('')
  // Key 用草稿：存盘要过 AndroidKeyStore 加密，逐字符写既慢又会让 store 出现空值，
  // 而 store 一空主界面就会切到首次引导页。
  const [keyDraft, setKeyDraft] = useState('')

  const commitKey = (): void => {
    const next = keyDraft.trim()
    // 空草稿不落盘：清空输入框再失焦就把 Key 删掉太容易误伤，
    // 而且 Key 一空主界面会切到首次引导页。要删 Key 请走显式的入口。
    if (!next || next === (apiKey ?? '')) {
      return
    }
    if (!setApiKey(next)) {
      setStatus(tr('API Key 保存失败', 'Could not save the key'))
    }
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
    if (text.startsWith('HTTP 403')) {
      return tr('该 Key 无权访问（403）', 'No access (403)')
    }
    if (text.startsWith('HTTP 404')) {
      return tr('接口不存在（404），检查是否少了 /v1', 'Not found (404)')
    }
    if (text === 'unexpected response') {
      return tr('不是 OpenAI 兼容格式', 'Not OpenAI-compatible')
    }
    return text
  }

  const loadModels = async () => {
    commitKey()
    const key = useSettings.getState().apiKey ?? ''
    setBusy('models')
    setStatus(tr('正在获取模型…', 'Fetching…'))
    try {
      const list = await fetchProviderModels(providerBaseUrl, key)
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
    const key = useSettings.getState().apiKey ?? ''
    setBusy('conn')
    setStatus(tr('正在测试连接…', 'Testing…'))
    const started = performance.now()
    try {
      const list = await fetchProviderModels(providerBaseUrl, key)
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
    setStatus(tr('正在测首字延迟…', 'Measuring…'))
    const started = performance.now()
    commitKey()
    // 首字延迟要量"第一个增量到达"，不是整条流跑完；推理模型尤其会把总时长拉得很长。
    let firstTokenAt = 0
    try {
      await streamOpenAiChat(
        {
          baseUrl: providerBaseUrl,
          apiKey: useSettings.getState().apiKey ?? '',
          model,
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 1,
        },
        () => {
          firstTokenAt ||= performance.now()
        }
      )
      const elapsed = Math.round((firstTokenAt || performance.now()) - started)
      setStatus(tr(`首字延迟约 ${elapsed}ms`, `First token ~${elapsed}ms`))
    } catch (error) {
      setStatus(tr('性能测试失败：', 'Failed: ') + describe(error))
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
                  {item.id === providerId ? <IconCheckOutline16 /> : null}
                </button>
              ))}
            </div>
          ) : null}

          <Row
            label="API Key"
            value={apiKey ? '••••••••' : tr('未设置', 'not set')}
            active={open === 'key'}
            onClick={() => {
              setKeyDraft(apiKey ?? '')
              toggle('key')
            }}
          />
          {open === 'key' ? (
            <div className={styles.editor}>
              <div className={styles.inline}>
                <input
                  className={styles.field}
                  type={reveal ? 'text' : 'password'}
                  value={keyDraft}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={tr('粘贴 API Key', 'Paste API key')}
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
            label={tr('测试模型性能', 'Test performance')}
            value={busy === 'perf' ? tr('测试中…', 'testing…') : ''}
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
