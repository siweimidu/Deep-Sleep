import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { MemoryBlock, SessionAnchor } from '../../services/chat/types.js'
import styles from './ContextSummaryCard.module.css'

/**
 * 上下文摘要卡片：把"开头存档"和"事实账本"显示在对话顶部。
 *
 * 这两份数据本来就有、也会被注入系统提示词，但用户在对话里完全看不到，
 * 于是"模型为什么还记得很早以前的事""为什么它记得的和原文不完全一样"都没有解释。
 * 这里把它们摊开：默认只露三行，展开后给全文，并且说明它们是压缩产物而不是原文。
 */
export const ContextSummaryCard = ({
  anchor,
  memory = [],
}: {
  anchor?: SessionAnchor
  memory?: MemoryBlock[]
}) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  if (!anchor && memory.length === 0) {
    return null
  }
  const blocks = [...(anchor ? [{ key: 'anchor', text: anchor.text }] : []), ...memory.map((block) => ({
    key: `m${block.index}`,
    text: block.text,
  }))]
  const total = blocks.length
  return (
    <div className={styles.card} data-open={open ? '' : undefined}>
      <div className={styles.head}>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.eyebrow}>{t('contextSummary')}</span>
        <span className={styles.count}>
          {anchor ? t('contextSummaryAnchor') : ''}
          {anchor && memory.length > 0 ? ' · ' : ''}
          {memory.length > 0 ? `${memory.length} ${t('contextSummaryMemory')}` : ''}
        </span>
        {total > 0 ? (
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? t('contextSummaryCollapse') : t('contextSummaryExpand')}
          </button>
        ) : null}
      </div>
      <div className={styles.body}>
        {blocks.map((block) => (
          <p key={block.key} className={styles.block}>
            {block.text}
          </p>
        ))}
      </div>
    </div>
  )
}
