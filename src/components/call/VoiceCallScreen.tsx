import { useEffect, useRef, useState } from 'react'
import { usePredictiveBack } from '../../app/backGesture.js'
import { useTranslate } from '../../i18n/index.js'
import { useSettings, setTtsVoice, setSearch } from '../../services/settings.js'
import { useChatStore } from '../../services/chat/store.js'
import { closeVoiceCall, useVoiceCall } from './callState.js'
import { formatDuration, PHASE_CODE, useCallSession, useOrbPulse } from './useCallSession.js'
import { LiquidOrb } from './LiquidOrb.js'
import { IconGlobeLanguageOutline14 } from '../base/icons.js'
import { IconPhoneOffOutline, IconSwitchOutline20 } from '../base/appIcons.js'
import styles from './VoiceCallScreen.module.css'
import sheetStyles from './CallSettingsSheet.module.css'
import { blockDrawerSwipe } from '../../app/android.js'

const MicrophoneIcon = ({ muted }: { muted: boolean }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.4a3 3 0 0 1 3 3v5.2a3 3 0 0 1-6 0V6.4a3 3 0 0 1 3-3Z" fill="currentColor" />
    <path
      d="M6.4 10.8a5.6 5.6 0 0 0 11.2 0M12 16.4v3.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    />
    {muted ? <path d="m4.5 3.5 15 15" stroke="#ff5a52" strokeWidth="2.2" strokeLinecap="round" /> : null}
  </svg>
)

/** 通话页里的「朗读音色 + 回答设置」底部弹层 */
const CallSettingsSheet = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate()
  const { ttsVoice, search } = useSettings()
  const tones = [
    { id: 'stella' as const, label: t('settingsTtsVoiceStella'), description: t('callVoiceSweet') },
    { id: 'tide' as const, label: t('settingsTtsVoiceTide'), description: t('callVoiceDeep') },
  ]
  const active = tones.findIndex((tone) => tone.id === ttsVoice)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startX = useRef<number | null>(null)

  /** 跟手位移：系数 0.55 让卡片贴着手指走，两端再收一点，避免拖出边界 */
  const follow = (value: number) => Math.max(-120, Math.min(120, value * 0.55))

  const switchTo = (step: number) => {
    const next = (Math.max(0, active) + step + tones.length) % tones.length
    setTtsVoice(tones[next].id)
  }

  return (
    <div className={sheetStyles.sheetBackdrop} onClick={onClose} role="presentation">
      <section className={sheetStyles.sheet} onClick={(event) => event.stopPropagation()}>
        <h2>{t('callVoiceTitle')}</h2>
        <div
          className={sheetStyles.voiceStage}
          role="presentation"
          // 横滑切换音色由弹层自己处理：声明后抽屉手势必须让路（JS 与 Java 两层都认这个属性），
          // 否则抽屉会把 pointer 抢走，拖拽直接收到 pointercancel。
          data-drawer-gesture-ignore=""
          data-dragging={dragging ? '' : undefined}
          style={{ transform: `translateX(${follow(dragX)}px)` }}
          onPointerDown={(event) => {
            startX.current = event.clientX
            setDragging(true)
            blockDrawerSwipe(true)
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (startX.current === null) {
              return
            }
            setDragX(event.clientX - startX.current)
          }}
          onPointerUp={(event) => {
            const moved = startX.current === null ? 0 : event.clientX - startX.current
            startX.current = null
            setDragging(false)
            setDragX(0)
            blockDrawerSwipe(false)
            if (Math.abs(moved) > 36) {
              switchTo(moved < 0 ? 1 : -1)
            }
          }}
          onPointerCancel={() => {
            startX.current = null
            setDragging(false)
            setDragX(0)
            blockDrawerSwipe(false)
          }}
        >
          <div className={sheetStyles.voicePreview} data-voice={ttsVoice} aria-hidden="true" />
          <div className={sheetStyles.voiceName}>{tones[active]?.label}</div>
          <div className={sheetStyles.voiceDesc}>{tones[active]?.description}</div>
          <div className={sheetStyles.dots} role="radiogroup" aria-label={t('callVoiceTitle')}>
            {tones.map((tone, index) => (
              <button
                key={tone.id}
                type="button"
                role="radio"
                aria-checked={index === active}
                aria-label={tone.label}
                className={sheetStyles.dot}
                onClick={() => setTtsVoice(tone.id)}
              />
            ))}
          </div>
        </div>
        <h2 className={sheetStyles.sectionTitle}>{t('callAnswerSettings')}</h2>
        <button
          type="button"
          className={sheetStyles.toggleRow}
          aria-pressed={search}
          onClick={() => setSearch(!search)}
        >
          <span className={sheetStyles.toggleLabel}>
            <IconGlobeLanguageOutline14 />
            {t('searchModeLabel')}
          </span>
          <span className={sheetStyles.switch} data-on={search ? 'true' : undefined} aria-hidden="true" />
        </button>
        <button type="button" className={sheetStyles.confirm} onClick={onClose}>
          {t('confirm')}
        </button>
      </section>
    </div>
  )
}

/**
 * 语音通话整屏。版式对齐官方 App：
 * 左上标题 + 「通话中 00:16」、中间一颗磨砂白玉球、下面「••• 正在聆听」、
 * 底部三个等大的深色圆钮（麦克风 / 挂断 / 文）。
 *
 * 球体的逐帧参数来自 Rust（`call-rs` 的 orb_params），由 useOrbPulse 直接写 CSS 变量，
 * 不进 React 渲染 —— 60fps 的 setState 会把主线程吃满。
 */
export const VoiceCallScreen = () => {
  const open = useVoiceCall((state) => state.open)
  const t = useTranslate()
  const title = useChatStore((state) => {
    const active = state.sessions.find((session) => session.id === state.activeId)
    return active?.title ?? ''
  })
  const [sheet, setSheet] = useState(false)
  // WebGL 用不了就退回 CSS 球：宁可少点质感，也不能没有球
  const [webgl, setWebgl] = useState(true)
  const page = useRef<HTMLDivElement>(null)
  const { phase, level, seconds, toggleMute, interrupt, endCall } = useCallSession(open)

  usePredictiveBack(page, closeVoiceCall, open)
  useOrbPulse(page, phase, level, open)

  useEffect(() => {
    if (!open) {
      setSheet(false)
    }
  }, [open])

  if (!open) {
    return null
  }

  const status =
    phase === 'muted'
      ? t('callMuted')
      : phase === 'thinking'
        ? t('callThinking')
        : phase === 'speaking'
          ? t('callSpeaking')
          : t('callListening')

  const hangup = () => {
    endCall()
    closeVoiceCall()
  }

  return (
    <div className={styles.page} data-phase={phase} ref={page}>
      <div className={styles.backdrop} aria-hidden="true">
        <span className={styles.vignette} />
      </div>

      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1>{title || t('untitledChat')}</h1>
          <span className={styles.timer}>{t('callInProgress', { time: formatDuration(seconds) })}</span>
        </div>
        <button
          type="button"
          className={styles.headerButton}
          aria-label={t('callVoiceTitle')}
          onClick={() => setSheet(true)}
        >
          <IconSwitchOutline20 />
        </button>
      </header>

      <div className={styles.stage}>
        <div className={styles.orbField} aria-hidden="true">
          {webgl ? (
            <LiquidOrb
              className={styles.orbCanvas}
              level={level}
              phaseCode={PHASE_CODE[phase]}
              size={176}
              onFallback={() => setWebgl(false)}
            />
          ) : (
            <div className={styles.orb}>
              <span className={styles.orbCore} />
            </div>
          )}
        </div>

        <div className={styles.status} aria-live="polite">
          <span className={styles.dots} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {status}
        </div>
      </div>

      {phase === 'speaking' ? (
        <button type="button" className={styles.interrupt} onClick={interrupt}>
          <span className={styles.interruptMark} aria-hidden="true" />
          {t('callInterrupt')}
        </button>
      ) : null}

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.round}
          data-muted={phase === 'muted' ? 'true' : undefined}
          aria-label={phase === 'muted' ? t('callUnmute') : t('callMute')}
          aria-pressed={phase === 'muted'}
          onClick={toggleMute}
        >
          <MicrophoneIcon muted={phase === 'muted'} />
        </button>

        <button
          type="button"
          className={styles.round}
          data-tone="danger"
          aria-label={t('callEnd')}
          onClick={hangup}
        >
          <IconPhoneOffOutline />
        </button>

        <button
          type="button"
          className={styles.round}
          aria-label={t('callTextMode')}
          onClick={hangup}
        >
          <span aria-hidden="true">文</span>
        </button>
      </div>

      <p className={styles.caveat}>{t('androidContentCaveat')}</p>
      {sheet ? <CallSettingsSheet onClose={() => setSheet(false)} /> : null}
    </div>
  )
}
