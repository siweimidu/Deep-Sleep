import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { transcribe } from '../../services/api/speech.js'
import { setDraftText } from '../../services/chat/drafts.js'
import { sendMessage, useChatStore } from '../../services/chat/store.js'
import { buildReplyView } from '../../services/chat/view.js'
import { readAloudText } from '../../services/speech/readAloud.js'
import { startRecording, type Recording } from '../../services/speech/recorder.js'
import { useSettings } from '../../services/settings.js'
import {
  ensureCallCore,
  createLevelSmoother,
  createTurnDetector,
  nextPhase,
  orbParams,
  PHASE_LISTENING,
  PHASE_MUTED,
  PHASE_SPEAKING,
  PHASE_THINKING,
  TURN_END,
  EVENT_INTERRUPT,
  EVENT_LISTEN,
  EVENT_MUTE,
  EVENT_SPEAK,
  EVENT_SPOKEN,
  EVENT_THINK,
  EVENT_UNMUTE,
} from '../../rust-core/call.js'
import { showToast } from '../base/toastState.js'

export type CallPhase = 'listening' | 'thinking' | 'speaking' | 'muted'

export const PHASE_CODE: Record<CallPhase, number> = {
  listening: PHASE_LISTENING,
  thinking: PHASE_THINKING,
  speaking: PHASE_SPEAKING,
  muted: PHASE_MUTED,
}

const PHASE_BY_CODE: CallPhase[] = ['listening', 'thinking', 'speaking', 'muted']

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 通话主循环：录一轮（静音判停）→ 转写 → 发消息 → 等回复 → 朗读 → 继续录。
 * 判停、包络、光球参数都来自 Rust（`call-rs`），这里只负责有副作用的那部分。
 * 用递增的 ticket 作废整轮，静音/挂断/离开页面时只需 +1 就能让所有 await 失效。
 */
export const useCallSession = (active: boolean) => {
  const [phase, setPhase] = useState<CallPhase>('listening')
  const [seconds, setSeconds] = useState(0)
  const [round, setRound] = useState(0)
  const recording = useRef<Recording | null>(null)
  const playback = useRef<AbortController | null>(null)
  const loop = useRef(0)
  // 逐帧电平放在 ref 里：球体由 rAF 直接读，不进 React 渲染，否则每秒 60 次重渲染必卡
  const level = useRef(0)
  const phaseCode = useRef<number>(PHASE_LISTENING)

  const applyPhase = useCallback((code: number) => {
    phaseCode.current = code
    setPhase(PHASE_BY_CODE[code] ?? 'listening')
  }, [])

  /** 阶段迁移统一走 Rust 状态机，UI 里不许各写各的 */
  const dispatch = useCallback(
    (eventCode: number) => {
      applyPhase(nextPhase(phaseCode.current, eventCode))
    },
    [applyPhase]
  )

  const stopAll = useCallback(() => {
    loop.current += 1
    recording.current?.cancel()
    recording.current = null
    playback.current?.abort()
    playback.current = null
    level.current = 0
  }, [])

  useEffect(() => {
    if (!active) {
      return stopAll
    }
    const ticket = ++loop.current
    applyPhase(PHASE_LISTENING)
    setSeconds(0)
    level.current = 0

    /** 录到用户停止说话，返回这段音频 */
    const recordTurn = () =>
      new Promise<Blob | null>((resolve) => {
        void (async () => {
          // 先确保 Rust 核心在位：通话开始就加载，判停从第一帧起走 Rust
          await ensureCallCore()
          let current: Recording
          try {
            current = await startRecording(() => undefined)
          } catch {
            showToast({ key: 'androidMicPermissionDenied', type: 'error' })
            applyPhase(PHASE_MUTED)
            resolve(null)
            return
          }
          if (ticket !== loop.current) {
            current.cancel()
            resolve(null)
            return
          }
          recording.current = current
          const detector = createTurnDetector()
          const smoother = createLevelSmoother()
          let lastAt = performance.now()
          const tick = () => {
            if (ticket !== loop.current || recording.current !== current) {
              resolve(null)
              return
            }
            const now = performance.now()
            // 真机验证用的注入口：只有调试包会用到（页面开 ?diag=1），生产里这个全局不存在
            const injected = (window as unknown as { __dshCallLevel?: number }).__dshCallLevel
            const raw = typeof injected === 'number' ? injected : (current.level?.() ?? 0)
            // 判停用原始电平（要灵敏），球体用包络（要好看）
            level.current = smoother.step(raw, now - lastAt)
            lastAt = now
            if (detector.push(raw, now) === TURN_END) {
              // 记一笔，真机验证据此确认"判停真的走到了这里"
              const stats = (window as unknown as { __dshCallStats?: { turns: number; at: number } })
              stats.__dshCallStats = { turns: (stats.__dshCallStats?.turns ?? 0) + 1, at: Math.round(now) }
              recording.current = null
              level.current = 0
              void current
                .stop()
                .then((audio) => audio)
                .catch(() => null)
                .then((audio) => {
                  current.cancel()
                  resolve(audio)
                })
              return
            }
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })()
      })

    const run = async () => {
      while (ticket === loop.current) {
        const audio = await recordTurn()
        if (!audio || ticket !== loop.current) {
          return
        }
        let text = ''
        try {
          text = (await transcribe(useSettings.getState().apiKey ?? '', audio)).trim()
        } catch {
          showToast({ key: 'voiceInputFailed', type: 'error' })
        }
        if (ticket !== loop.current) {
          return
        }
        if (!text) {
          continue
        }

        const sessionId = useChatStore.getState().activeId
        dispatch(EVENT_THINK)
        setDraftText(sessionId, text)
        if (!sendMessage(sessionId)) {
          dispatch(EVENT_LISTEN)
          continue
        }

        // 等这一轮回复生成完，整段一次性朗读：分句朗读会出现听到的和看到的对不上
        const replyText = () => {
          const state = useChatStore.getState()
          const id = sessionId ?? state.activeId
          const session = id ? state.sessionCache[id] : null
          const last = session?.messages.filter((item) => item.role === 'assistant').at(-1)
          return {
            id: last?.id ?? null,
            text: last ? (buildReplyView(last, false).answer?.text ?? '').trim() : '',
            streaming: id ? Boolean(state.streaming[id]) : Object.keys(state.streaming).length > 0,
          }
        }

        let spokenText = ''
        let replyId: string | null = null
        for (let step = 0; step < 1800; step++) {
          const snapshot = replyText()
          replyId = snapshot.id ?? replyId
          if (!snapshot.streaming && step > 4) {
            spokenText = snapshot.text
            break
          }
          await wait(120)
          if (ticket !== loop.current) {
            return
          }
        }
        if (ticket !== loop.current) {
          return
        }
        if (spokenText.trim()) {
          playback.current?.abort()
          playback.current = new AbortController()
          const controller = playback.current
          dispatch(EVENT_SPEAK)
          await readAloudText(replyId ?? `call-${Date.now()}`, spokenText, controller.signal, () =>
            showToast({ key: 'ttsFailed', type: 'error' })
          )
          playback.current = null
        }
        if (ticket !== loop.current) {
          return
        }
        dispatch(EVENT_SPOKEN)
      }
    }

    void run()
    return stopAll
  }, [active, round, stopAll, applyPhase, dispatch])

  useEffect(() => {
    if (!active) {
      return
    }
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500)
    return () => clearInterval(timer)
  }, [active])

  const toggleMute = useCallback(() => {
    if (phase !== 'muted') {
      stopAll()
      // 静音也走状态机：静音态下其它事件一律不生效，这条规则只在 Rust 里写一次
      dispatch(EVENT_MUTE)
      return
    }
    dispatch(EVENT_UNMUTE)
    // 换一个 round 让主循环重新起一轮
    setRound((value) => value + 1)
  }, [phase, stopAll, dispatch])

  /** 打断当前朗读，立刻回到收音 */
  const interrupt = useCallback(() => {
    playback.current?.abort()
    playback.current = null
    dispatch(EVENT_INTERRUPT)
    setRound((value) => value + 1)
  }, [dispatch])

  return { phase, level: level, seconds, toggleMute, interrupt, endCall: stopAll }
}

/**
 * 光球脉冲：每帧把 Rust 算出来的形状参数写进 CSS 变量。
 * 刻意不进 React：60fps 的 setState 会把主线程吃满，写 CSS 变量只触发合成。
 */
export const useOrbPulse = (
  ref: RefObject<HTMLElement | null>,
  phase: CallPhase,
  level: { readonly current: number },
  active: boolean
) => {
  useEffect(() => {
    const element = ref.current
    // active 必须在依赖里：关闭时组件先渲染成 null，ref 还是空的；
    // 少了它会「只在关闭状态跑过一次」，打开后变量永远停在样式表默认值。
    if (!active || !element) {
      return
    }
    const code = PHASE_CODE[phase] ?? PHASE_LISTENING
    let frame = 0
    let start = performance.now()
    const tick = (now: number) => {
      const params = orbParams(level.current, code, now - start)
      element.style.setProperty('--orb-core', params.core.toFixed(4))
      element.style.setProperty('--orb-glow', params.glow.toFixed(4))
      element.style.setProperty('--orb-halo', params.halo.toFixed(4))
      element.style.setProperty('--orb-spin', params.spin.toFixed(4))
      element.style.setProperty('--orb-breathe', params.breathe.toFixed(4))
      element.dataset.speaking = level.current > 0.06 ? 'true' : 'false'
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      start = 0
    }
  }, [ref, phase, level, active])
}

export { formatDuration } from '../../rust-core/call.js'
