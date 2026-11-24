import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { android } from '../../app/android.js'
import { useTranslate } from '../../i18n/index.js'
import type { Source } from '../../services/chat/view.js'
import { formatDate } from '../../utils/format.js'
import { closeSearchPanel, useSearchPanel } from './searchPanelState.js'
import { SiteLogo } from './SiteLogo.js'
import styles from './AndroidSearchPanel.module.css'

const TRANSITION_MS = 240

type DisplayedResults = { entry: string; sources: Source[] }

const AndroidSource = ({ source, single }: { source: Source; single: boolean }) => {
  const t = useTranslate()
  const date = source.publishedAt ? (formatDate(source.publishedAt, '/') ?? source.publishedAt) : ''
  return (
    <button
      type="button"
      className={styles.result}
      onClick={() => {
        android?.openSourcePage(
          source.url,
          document.body.hasAttribute('data-ds-dark-theme'),
          t('close'),
          t('openInBrowser')
        )
      }}
    >
      <div className={styles.meta}>
        <SiteLogo url={source.siteIcon} className={styles.logo} />
        <span className={styles.siteName}>{source.siteName}</span>
        {date ? <span className={styles.date}>{date}</span> : null}
        <span className={styles.number}>{source.index}</span>
      </div>
      <span className={styles.resultTitle}>{source.title}</span>
      {source.snippet ? (
        <span className={styles.snippet} data-single={single}>
          {source.snippet}
        </span>
      ) : null}
    </button>
  )
}

/** Android 搜索来源以底部面板显示，关闭时保留内容直到退出动画结束。 */
export const AndroidSearchPanel = () => {
  const t = useTranslate()
  const entry = useSearchPanel((state) => state.entry)
  const sources = useSearchPanel((state) => state.sources)
  const [displayed, setDisplayed] = useState<DisplayedResults | null>(null)
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (entry) {
      overlayRef.current?.style.removeProperty('--result-drag-offset')
      overlayRef.current?.style.removeProperty('--result-scrim-opacity')
      setDisplayed({ entry, sources })
      setScrolled(false)
      const frame = requestAnimationFrame(() => setOpen(true))
      return () => cancelAnimationFrame(frame)
    }
    setOpen(false)
    const timer = setTimeout(() => setDisplayed(null), TRANSITION_MS)
    return () => clearTimeout(timer)
  }, [entry, sources])

  useEffect(() => {
    if (!entry) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSearchPanel()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [entry])

  useEffect(() => {
    const overlay = overlayRef.current
    const sheet = sheetRef.current
    const content = contentRef.current
    if (!entry || !overlay || !sheet || !content) {
      return
    }

    let gesture: {
      id: number
      x: number
      y: number
      inContent: boolean
      dragging: boolean
      offset: number
      height: number
    } | null = null

    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !(event.target instanceof Node)) {
        return
      }
      const touch = event.touches[0]
      gesture = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        inContent: content.contains(event.target),
        dragging: false,
        offset: 0,
        height: sheet.getBoundingClientRect().height,
      }
    }

    const touchMove = (event: TouchEvent) => {
      if (!gesture) {
        return
      }
      const touch = Array.from(event.touches).find((item) => item.identifier === gesture?.id)
      if (!touch) {
        return
      }

      // Let the list scroll normally until it reaches its upper edge.
      if (!gesture.dragging && gesture.inContent && content.scrollTop > 0) {
        gesture.x = touch.clientX
        gesture.y = touch.clientY
        return
      }
      const deltaY = touch.clientY - gesture.y
      if (!gesture.dragging && (deltaY <= 0 || deltaY <= Math.abs(touch.clientX - gesture.x))) {
        return
      }
      if (event.cancelable) {
        event.preventDefault()
      }
      if (!gesture.dragging && deltaY < 6) {
        return
      }

      gesture.dragging = true
      gesture.offset = Math.max(0, Math.min(deltaY - 6, gesture.height))
      overlay.dataset.dragging = 'true'
      overlay.style.setProperty('--result-drag-offset', `${gesture.offset}px`)
      overlay.style.setProperty(
        '--result-scrim-opacity',
        String(0.32 * (1 - gesture.offset / gesture.height))
      )
    }

    const touchEnd = (event: TouchEvent) => {
      if (
        !gesture ||
        !Array.from(event.changedTouches).some((item) => item.identifier === gesture?.id)
      ) {
        return
      }
      const { dragging, offset, height } = gesture
      gesture = null
      if (!dragging) {
        return
      }
      if (event.cancelable) {
        event.preventDefault()
      }
      delete overlay.dataset.dragging
      if (event.type !== 'touchcancel' && offset > height / 2) {
        closeSearchPanel()
      } else {
        overlay.style.removeProperty('--result-drag-offset')
        overlay.style.removeProperty('--result-scrim-opacity')
      }
    }

    sheet.addEventListener('touchstart', touchStart, { passive: true })
    sheet.addEventListener('touchmove', touchMove, { passive: false })
    sheet.addEventListener('touchend', touchEnd, { passive: false })
    sheet.addEventListener('touchcancel', touchEnd, { passive: false })
    return () => {
      sheet.removeEventListener('touchstart', touchStart)
      sheet.removeEventListener('touchmove', touchMove)
      sheet.removeEventListener('touchend', touchEnd)
      sheet.removeEventListener('touchcancel', touchEnd)
    }
  }, [displayed?.entry, entry])

  if (!displayed) {
    return null
  }
  return (
    <div ref={overlayRef} className={styles.overlay} data-open={open} data-drawer-gesture-ignore="">
      <div className={styles.scrim} onClick={closeSearchPanel} aria-hidden="true" />
      <section
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={t('searchResult')}
      >
        <div className={styles.header} data-scrolled={scrolled}>
          <span>{t('searchResult')}</span>
          <button
            className={styles.close}
            type="button"
            aria-label={t('close')}
            onClick={closeSearchPanel}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5.2 5.2 14.8 14.8M14.8 5.2 5.2 14.8" />
            </svg>
          </button>
        </div>
        <div
          ref={contentRef}
          key={displayed.entry}
          className={styles.content}
          data-single={displayed.sources.length === 1}
          onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
        >
          {displayed.sources.map((source) => (
            <AndroidSource
              key={source.url}
              source={source}
              single={displayed.sources.length === 1}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
