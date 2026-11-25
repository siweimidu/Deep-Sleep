/**
 * Rust 核心适配层：通话逻辑（`call-rs`）。
 *
 * 分工：
 *   * Rust 负责**确定性**的部分 —— 判停、电平包络、光球参数、时长格式化；
 *   * TS 负责有副作用的部分 —— 录音、转写、TTS、渲染。
 *
 * 为什么要有回退：wasm 是加速与统一口径的路径，不是依赖。
 * 加载失败（老 WebView、缓存坏了）就整段走这份 TS 实现，
 * 两份实现由 `scripts/test-call-core.mjs` 逐值对照，不允许漂移。
 */
import init, {
  WasmLevelSmoother,
  WasmTurnDetector,
  format_duration_js as rustFormatDuration,
  next_phase_code as rustNextPhase,
  orb_params_js as rustOrbParams,
} from '../../rust/call-rs/pkg/call_rs.js'
import { diagnosticsEnabled } from './diagnostics.js'

export type TurnConfig = {
  speechLevel: number
  silenceMs: number
  minSpeechMs: number
  graceMs: number
}

/** 与 Rust `TurnSignal` 的编码一致 */
export const TURN_IDLE = 0
export const TURN_SPEAKING = 1
export const TURN_PAUSING = 2
export const TURN_END = 3

export type OrbParams = { core: number; glow: number; halo: number; spin: number; breathe: number }

/** 与 Rust `Phase` 的编码一致 */
export const PHASE_LISTENING = 0
export const PHASE_THINKING = 1
export const PHASE_SPEAKING = 2
export const PHASE_MUTED = 3

/** 与 Rust `Event` 的编码一致 */
export const EVENT_LISTEN = 0
export const EVENT_THINK = 1
export const EVENT_SPEAK = 2
export const EVENT_SPOKEN = 3
export const EVENT_INTERRUPT = 4
export const EVENT_MUTE = 5
export const EVENT_UNMUTE = 6

export const DEFAULT_TURN: TurnConfig = {
  speechLevel: 0.045,
  silenceMs: 620,
  minSpeechMs: 260,
  graceMs: 220,
}

/** 起音快、释放慢：球体跟手但不跟着麦克风抖 */
export const ATTACK_MS = 90
export const RELEASE_MS = 260

// ── TS 回退实现（与 Rust 逐行对应，改动必须两边一起改）────────────────────────

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export const fallback = {
  turnDetector(config: TurnConfig) {
    let spokeAt: number | null = null
    let quietSince: number | null = null
    return {
      push(level: number, nowMs: number) {
        if (level > config.speechLevel) {
          spokeAt = nowMs
          quietSince = null
          return TURN_SPEAKING
        }
        if (spokeAt === null) {
          return TURN_IDLE
        }
        if (nowMs - spokeAt > config.graceMs && quietSince === null) {
          quietSince = nowMs
        }
        if (
          quietSince !== null &&
          nowMs - quietSince > config.silenceMs &&
          nowMs - spokeAt > config.minSpeechMs
        ) {
          return TURN_END
        }
        return TURN_PAUSING
      },
      reset() {
        spokeAt = null
        quietSince = null
      },
    }
  },

  levelSmoother(attackMs: number, releaseMs: number) {
    let value = 0
    return {
      step(raw: number, dtMs: number) {
        const target = clamp01(raw)
        const ms = target > value ? attackMs : releaseMs
        const dt = Math.max(0, dtMs)
        const k = ms <= 0 ? 1 : Math.min(1, Math.max(0, 1 - Math.exp(-dt / ms)))
        value += (target - value) * k
        if (value < 0.0005) {
          value = 0
        }
        return value
      },
      value: () => value,
      reset() {
        value = 0
      },
    }
  },

  orbParams(level: number, phaseCode: number, tMs: number): OrbParams {
    const energy = clamp01(level)
    const sine = (period: number) => Math.sin((tMs / period) * Math.PI * 2) * 0.5 + 0.5
    const breathe = sine(2600)
    if (phaseCode === PHASE_THINKING) {
      const pulse = sine(1100)
      return {
        core: 0.42 + pulse * 0.22,
        glow: 0.3 + pulse * 0.2,
        halo: 0.62 + pulse * 0.16,
        spin: 0.85,
        breathe,
      }
    }
    if (phaseCode === PHASE_SPEAKING) {
      const pulse = sine(820)
      return {
        core: 0.82 + pulse * 0.18,
        glow: 0.55 + pulse * 0.35,
        halo: 0.8 + pulse * 0.2,
        spin: 0.15,
        breathe,
      }
    }
    if (phaseCode === PHASE_MUTED) {
      return { core: 0.22, glow: 0.08, halo: 0.3 + breathe * 0.04, spin: 0.05, breathe }
    }
    return {
      core: 0.6 + energy * 0.4,
      glow: 0.18 + Math.pow(energy, 0.75) * 0.82,
      halo: 0.55 + energy * 0.45,
      spin: 0.35 + energy * 0.65,
      breathe,
    }
  },

  nextPhase(phaseCode: number, eventCode: number): number {
    const listening = PHASE_LISTENING
    const thinking = PHASE_THINKING
    const speaking = PHASE_SPEAKING
    const muted = PHASE_MUTED
    if (eventCode === EVENT_MUTE) {
      return muted
    }
    if (phaseCode === muted) {
      return eventCode === EVENT_UNMUTE ? listening : muted
    }
    if (eventCode === EVENT_LISTEN) {
      return listening
    }
    if (eventCode === EVENT_THINK) {
      return thinking
    }
    if (eventCode === EVENT_SPEAK) {
      return speaking
    }
    if (phaseCode === speaking && eventCode === EVENT_SPOKEN) {
      return listening
    }
    if (eventCode === EVENT_INTERRUPT) {
      return listening
    }
    return phaseCode
  },

  formatDuration(totalSeconds: number): string {
    const secs = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0
    const hours = Math.floor(secs / 3600)
    const minutes = Math.floor((secs % 3600) / 60)
    const seconds = secs % 60
    const pad = (value: number) => String(value).padStart(2, '0')
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
  },
}

// ── wasm 装载 ────────────────────────────────────────────────────────────────

type RustApi = {
  TurnDetector: typeof WasmTurnDetector
  LevelSmoother: typeof WasmLevelSmoother
  orbParams: typeof rustOrbParams
  nextPhase: typeof rustNextPhase
  formatDuration: typeof rustFormatDuration
}

let rust: RustApi | null = null
let loading: Promise<void> | null = null

const publish = (value: boolean, error?: string): void => {
  if (!diagnosticsEnabled()) {
    return
  }
  const scope = window as unknown as { __deepseekRust?: Record<string, unknown> }
  scope.__deepseekRust = {
    ...scope.__deepseekRust,
    call: value,
    ...(error === undefined ? {} : { callError: error }),
  }
}

/** 提前把 wasm 拉起来：通话开始前调用一次，之后每帧就走 Rust 了。 */
export const ensureCallCore = (): Promise<void> => {
  if (rust) {
    return Promise.resolve()
  }
  loading ??= init({ module_or_path: new URL('../../rust/call-rs/pkg/call_rs_bg.wasm', import.meta.url) })
    .then(() => {
      rust = {
        TurnDetector: WasmTurnDetector,
        LevelSmoother: WasmLevelSmoother,
        orbParams: rustOrbParams,
        nextPhase: rustNextPhase,
        formatDuration: rustFormatDuration,
      }
      publish(true)
    })
    .catch((error: unknown) => {
      publish(false, String(error))
      loading = null
    })
  return loading
}

export const callCoreReady = (): boolean => rust !== null

// ── 对外接口：有 Rust 走 Rust，没有就走回退 ──────────────────────────────────

export const createTurnDetector = (config: TurnConfig = DEFAULT_TURN) =>
  rust
    ? new rust.TurnDetector(config.speechLevel, config.silenceMs, config.minSpeechMs, config.graceMs)
    : fallback.turnDetector(config)

export const createLevelSmoother = (attackMs = ATTACK_MS, releaseMs = RELEASE_MS) =>
  rust ? new rust.LevelSmoother(attackMs, releaseMs) : fallback.levelSmoother(attackMs, releaseMs)

/** 每帧调用：返回 [core, glow, halo, spin, breathe] */
export const orbParams = (level: number, phaseCode: number, tMs: number): OrbParams => {
  if (rust) {
    const values = rust.orbParams(level, phaseCode, tMs)
    return {
      core: values[0],
      glow: values[1],
      halo: values[2],
      spin: values[3],
      breathe: values[4],
    }
  }
  return fallback.orbParams(level, phaseCode, tMs)
}

export const nextPhase = (phaseCode: number, eventCode: number): number =>
  rust ? rust.nextPhase(phaseCode, eventCode) : fallback.nextPhase(phaseCode, eventCode)

export const formatDuration = (seconds: number): string =>
  rust ? rust.formatDuration(seconds) : fallback.formatDuration(seconds)
