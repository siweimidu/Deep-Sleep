//! 通话界面的核心逻辑。
//!
//! 这里只放**确定性**的东西：给定一串 (电平, 时间戳) 输入，输出必须完全可复现，
//! 这样才有办法把「感觉对不对」变成可以测的断言：
//!
//!   * [`TurnDetector`] —— 说完没有：静音多久算一轮结束（原来是 rAF 里散着写的 if）
//!   * [`LevelSmoother`] —— 电平包络：起音快、释放慢，球体才不会跟着麦克风抖
//!   * [`orb_params`] —— 光球的形状参数：把「心跳感」变成几个 0..1 的数
//!   * [`format_duration`] —— 通话时长
//!   * [`next_phase`] —— 状态机：谁能跳到谁写死，避免 UI 里到处改状态
//!
//! 渲染、权限、录音、TTS 仍然留在 TS —— 那些有副作用，搬过来也测不了。

use wasm_bindgen::prelude::*;

/// 通话所处的阶段。数值给 wasm 用，顺序不要改。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    Listening = 0,
    Thinking = 1,
    Speaking = 2,
    Muted = 3,
}

impl Phase {
    pub fn from_code(code: u8) -> Phase {
        match code {
            1 => Phase::Thinking,
            2 => Phase::Speaking,
            3 => Phase::Muted,
            _ => Phase::Listening,
        }
    }
}

/// 会推动阶段变化的事件。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Event {
    /// 开始收音
    Listen,
    /// 一轮说完，等模型
    Think,
    /// 开始朗读回复
    Speak,
    /// 朗读结束，回到收音
    Spoken,
    /// 用户打断朗读
    Interrupt,
    /// 静音
    Mute,
    /// 解除静音
    Unmute,
}

/// 状态机：只允许这些迁移，其余一律原地不动。
pub fn next_phase(phase: Phase, event: Event) -> Phase {
    use Event as E;
    use Phase as P;
    match (phase, event) {
        // 静音是最高优先级：任何阶段都能被静音打断
        (_, E::Mute) => P::Muted,
        // 静音之外的事件在静音态下都不生效，必须先解除静音
        (P::Muted, E::Unmute) => P::Listening,
        (P::Muted, _) => P::Muted,
        (_, E::Listen) => P::Listening,
        (_, E::Think) => P::Thinking,
        (_, E::Speak) => P::Speaking,
        (P::Speaking, E::Spoken) => P::Listening,
        // 打断只对「正在说」有意义；别的阶段按重新收音处理，不留在错误状态里
        (_, E::Interrupt) => P::Listening,
        (_, E::Spoken) => phase,
        (_, E::Unmute) => phase,
    }
}

/// 说完没有。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TurnSignal {
    /// 还没开口
    Idle = 0,
    /// 正在说
    Speaking = 1,
    /// 停顿，但还不够久
    Pausing = 2,
    /// 这一轮说完了，可以截断录音
    EndTurn = 3,
}

/// 判停参数。默认值与 TS 侧一致。
#[derive(Clone, Copy, Debug)]
pub struct TurnConfig {
    /// 超过这个电平算在说话
    pub speech_level: f64,
    /// 说完之后安静这么久算一轮结束
    pub silence_ms: f64,
    /// 至少要说这么久才允许判停，避免一开口就被掐断
    pub min_speech_ms: f64,
    /// 说完之后先给它这么多余量再开始计静音（收尾的拖音）
    pub grace_ms: f64,
}

impl Default for TurnConfig {
    fn default() -> Self {
        Self {
            speech_level: 0.045,
            silence_ms: 620.0,
            min_speech_ms: 260.0,
            grace_ms: 220.0,
        }
    }
}

/// 把原来散在 rAF 里的判停逻辑收成一个可测的状态机。
#[derive(Clone, Debug, Default)]
pub struct TurnDetector {
    config: TurnConfig,
    spoke_at: Option<f64>,
    quiet_since: Option<f64>,
}

impl TurnDetector {
    pub fn new(config: TurnConfig) -> Self {
        Self {
            config,
            spoke_at: None,
            quiet_since: None,
        }
    }

    pub fn reset(&mut self) {
        self.spoke_at = None;
        self.quiet_since = None;
    }

    /// 喂一帧电平，返回这一帧的判定。
    pub fn push(&mut self, level: f64, now_ms: f64) -> TurnSignal {
        if level > self.config.speech_level {
            self.spoke_at = Some(now_ms);
            self.quiet_since = None;
            return TurnSignal::Speaking;
        }
        let Some(spoke) = self.spoke_at else {
            return TurnSignal::Idle;
        };
        // 收尾余量过了才开始计静音，否则气口会被当成说完
        if now_ms - spoke > self.config.grace_ms && self.quiet_since.is_none() {
            self.quiet_since = Some(now_ms);
        }
        match self.quiet_since {
            Some(quiet)
                if now_ms - quiet > self.config.silence_ms
                    && now_ms - spoke > self.config.min_speech_ms =>
            {
                TurnSignal::EndTurn
            }
            _ => TurnSignal::Pausing,
        }
    }
}

/// 电平包络：起音快、释放慢。
#[derive(Clone, Copy, Debug)]
pub struct LevelSmoother {
    value: f64,
    attack_ms: f64,
    release_ms: f64,
}

impl LevelSmoother {
    pub fn new(attack_ms: f64, release_ms: f64) -> Self {
        Self {
            value: 0.0,
            attack_ms,
            release_ms,
        }
    }

    pub fn value(&self) -> f64 {
        self.value
    }

    /// 一阶低通：时间常数决定跟手速度。dt 用毫秒。
    pub fn step(&mut self, raw: f64, dt_ms: f64) -> f64 {
        let target = raw.clamp(0.0, 1.0);
        let ms = if target > self.value {
            self.attack_ms
        } else {
            self.release_ms
        };
        let dt = dt_ms.max(0.0);
        let k = if ms <= 0.0 {
            1.0
        } else {
            1.0 - (-dt / ms).exp()
        };
        self.value += (target - self.value) * k.clamp(0.0, 1.0);
        if self.value < 0.0005 {
            self.value = 0.0;
        }
        self.value
    }

    pub fn reset(&mut self) {
        self.value = 0.0;
    }
}

/// 光球形状参数，全部 0..1（spin 是角速度倍数）。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OrbParams {
    /// 内核亮度
    pub core: f64,
    /// 外发光强度
    pub glow: f64,
    /// 光晕半径系数
    pub halo: f64,
    /// 旋转速度倍数
    pub spin: f64,
    /// 呼吸相位 0..1（由时间推出来，给 CSS 做 sin 抖动）
    pub breathe: f64,
}

/// 由电平、阶段、时间推出光球参数。
/// 思路：电平决定「能量」，阶段决定「性格」——
/// 听的时候跟着声音跳；思考时匀速脉动；说话时最亮；静音时几乎不动。
pub fn orb_params(level: f64, phase: Phase, t_ms: f64) -> OrbParams {
    let level = level.clamp(0.0, 1.0);
    let breathe = ((t_ms / 2600.0) * std::f64::consts::TAU).sin() * 0.5 + 0.5;
    match phase {
        Phase::Listening => OrbParams {
            core: 0.60 + level * 0.40,
            glow: 0.18 + level.powf(0.75) * 0.82,
            halo: 0.55 + level * 0.45,
            spin: 0.35 + level * 0.65,
            breathe,
        },
        Phase::Thinking => {
            // 思考时不受麦克风影响，必须匀速——否则和「正在想」的语义打架
            let pulse = ((t_ms / 1100.0) * std::f64::consts::TAU).sin() * 0.5 + 0.5;
            OrbParams {
                core: 0.42 + pulse * 0.22,
                glow: 0.30 + pulse * 0.20,
                halo: 0.62 + pulse * 0.16,
                spin: 0.85,
                breathe,
            }
        }
        Phase::Speaking => {
            let pulse = ((t_ms / 820.0) * std::f64::consts::TAU).sin() * 0.5 + 0.5;
            OrbParams {
                core: 0.82 + pulse * 0.18,
                glow: 0.55 + pulse * 0.35,
                halo: 0.80 + pulse * 0.20,
                spin: 0.15,
                breathe,
            }
        }
        Phase::Muted => OrbParams {
            core: 0.22,
            glow: 0.08,
            halo: 0.30 + breathe * 0.04,
            spin: 0.05,
            breathe,
        },
    }
}

/// 时长：不到一小时用 mm:ss，超过就 h:mm:ss。
pub fn format_duration(total_seconds: f64) -> String {
    let secs = if total_seconds.is_finite() {
        total_seconds.max(0.0).floor() as u64
    } else {
        0
    };
    let hours = secs / 3600;
    let minutes = (secs % 3600) / 60;
    let seconds = secs % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}

// ── wasm 边界 ────────────────────────────────────────────────────────────────

/// 判停器：TS 每帧喂 (level, now)，拿 0..3 的信号。
#[wasm_bindgen]
pub struct WasmTurnDetector {
    inner: TurnDetector,
}

#[wasm_bindgen]
impl WasmTurnDetector {
    #[wasm_bindgen(constructor)]
    pub fn new(speech_level: f64, silence_ms: f64, min_speech_ms: f64, grace_ms: f64) -> Self {
        Self {
            inner: TurnDetector::new(TurnConfig {
                speech_level,
                silence_ms,
                min_speech_ms,
                grace_ms,
            }),
        }
    }

    pub fn push(&mut self, level: f64, now_ms: f64) -> u8 {
        self.inner.push(level, now_ms) as u8
    }

    pub fn reset(&mut self) {
        self.inner.reset();
    }
}

/// 电平包络。
#[wasm_bindgen]
pub struct WasmLevelSmoother {
    inner: LevelSmoother,
}

#[wasm_bindgen]
impl WasmLevelSmoother {
    #[wasm_bindgen(constructor)]
    pub fn new(attack_ms: f64, release_ms: f64) -> Self {
        Self {
            inner: LevelSmoother::new(attack_ms, release_ms),
        }
    }

    pub fn step(&mut self, raw: f64, dt_ms: f64) -> f64 {
        self.inner.step(raw, dt_ms)
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> f64 {
        self.inner.value()
    }

    pub fn reset(&mut self) {
        self.inner.reset();
    }
}

/// 光球参数：[core, glow, halo, spin, breathe]
#[wasm_bindgen]
pub fn orb_params_js(level: f64, phase_code: u8, t_ms: f64) -> Vec<f64> {
    let p = orb_params(level, Phase::from_code(phase_code), t_ms);
    vec![p.core, p.glow, p.halo, p.spin, p.breathe]
}

/// 阶段迁移：给的是编码值，返回也是编码值。
#[wasm_bindgen]
pub fn next_phase_code(phase_code: u8, event_code: u8) -> u8 {
    let event = match event_code {
        1 => Event::Think,
        2 => Event::Speak,
        3 => Event::Spoken,
        4 => Event::Interrupt,
        5 => Event::Mute,
        6 => Event::Unmute,
        _ => Event::Listen,
    };
    next_phase(Phase::from_code(phase_code), event) as u8
}

#[wasm_bindgen]
pub fn format_duration_js(seconds: f64) -> String {
    format_duration(seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn smooth(raw: f64, dt: f64) -> f64 {
        let mut s = LevelSmoother::new(90.0, 260.0);
        s.step(raw, dt)
    }

    #[test]
    fn turn_needs_speech_before_it_can_end() {
        let mut d = TurnDetector::default();
        // 一直安静：不该判停（还没开口）
        assert_eq!(d.push(0.0, 0.0), TurnSignal::Idle);
        assert_eq!(d.push(0.0, 5_000.0), TurnSignal::Idle);
    }

    #[test]
    fn turn_ends_after_silence_past_grace() {
        let mut d = TurnDetector::default();
        assert_eq!(d.push(0.5, 0.0), TurnSignal::Speaking);
        assert_eq!(d.push(0.5, 300.0), TurnSignal::Speaking);
        // 安静下来：先过 220ms 余量（400 时还在余量里）
        assert_eq!(d.push(0.0, 400.0), TurnSignal::Pausing);
        // 余量走完，静音从 700 开始计
        assert_eq!(d.push(0.0, 700.0), TurnSignal::Pausing);
        // 620ms 静音还没满
        assert_eq!(d.push(0.0, 1_320.0), TurnSignal::Pausing);
        assert_eq!(d.push(0.0, 1_400.0), TurnSignal::EndTurn);
    }

    #[test]
    fn short_utterance_never_ends_by_itself() {
        let mut d = TurnDetector::default();
        assert_eq!(d.push(0.9, 0.0), TurnSignal::Speaking);
        // 只说了 100ms 就安静：min_speech 没到，不许判停
        assert_eq!(d.push(0.0, 100.0), TurnSignal::Pausing);
        assert_eq!(d.push(0.0, 900.0), TurnSignal::Pausing);
    }

    #[test]
    fn new_sound_resets_the_silence_clock() {
        let mut d = TurnDetector::default();
        assert_eq!(d.push(0.5, 0.0), TurnSignal::Speaking);
        assert_eq!(d.push(0.0, 500.0), TurnSignal::Pausing);
        assert_eq!(d.push(0.7, 800.0), TurnSignal::Speaking);
        // 800 重新开口：静音从头计，1000 还在余量里
        assert_eq!(d.push(0.0, 1_000.0), TurnSignal::Pausing);
        assert_eq!(d.push(0.0, 1_700.0), TurnSignal::Pausing);
        assert_eq!(d.push(0.0, 2_320.0), TurnSignal::Pausing);
        assert_eq!(d.push(0.0, 2_400.0), TurnSignal::EndTurn);
    }

    #[test]
    fn envelope_attacks_faster_than_it_releases() {
        let attack = smooth(1.0, 16.0);
        let mut s = LevelSmoother::new(90.0, 260.0);
        s.step(1.0, 400.0);
        let release = {
            let mut r = LevelSmoother::new(90.0, 260.0);
            r.step(1.0, 400.0);
            r.step(0.0, 16.0)
        };
        assert!(attack > 0.1 && attack < 1.0, "attack={attack}");
        // 同样一帧，下降的幅度必须比上升小
        assert!(1.0 - release < attack, "release={release} attack={attack}");
    }

    #[test]
    fn envelope_settles_and_clamps() {
        let mut s = LevelSmoother::new(90.0, 260.0);
        for _ in 0..200 {
            s.step(2.0, 16.0);
        }
        assert!((s.value() - 1.0).abs() < 1e-6);
        for _ in 0..400 {
            s.step(-1.0, 16.0);
        }
        assert_eq!(s.value(), 0.0);
    }

    #[test]
    fn phases_only_move_where_they_should() {
        assert_eq!(next_phase(Phase::Listening, Event::Mute), Phase::Muted);
        assert_eq!(next_phase(Phase::Muted, Event::Think), Phase::Muted);
        assert_eq!(next_phase(Phase::Muted, Event::Unmute), Phase::Listening);
        assert_eq!(next_phase(Phase::Speaking, Event::Interrupt), Phase::Listening);
        assert_eq!(next_phase(Phase::Speaking, Event::Spoken), Phase::Listening);
        assert_eq!(next_phase(Phase::Thinking, Event::Speak), Phase::Speaking);
    }

    #[test]
    fn orb_follows_level_when_listening() {
        let quiet = orb_params(0.0, Phase::Listening, 0.0);
        let loud = orb_params(1.0, Phase::Listening, 0.0);
        assert!(loud.core > quiet.core);
        assert!(loud.glow > quiet.glow);
        assert!(loud.halo > quiet.halo);
    }

    #[test]
    fn thinking_ignores_microphone() {
        let quiet = orb_params(0.0, Phase::Thinking, 1_000.0);
        let loud = orb_params(1.0, Phase::Thinking, 1_000.0);
        assert_eq!(quiet, loud);
    }

    #[test]
    fn muted_orb_stays_dim() {
        let muted = orb_params(1.0, Phase::Muted, 0.0);
        assert!(muted.core <= 0.25);
        assert!(muted.glow <= 0.1);
    }

    #[test]
    fn duration_formats() {
        assert_eq!(format_duration(0.0), "00:00");
        assert_eq!(format_duration(9.0), "00:09");
        assert_eq!(format_duration(61.0), "01:01");
        assert_eq!(format_duration(599.0), "09:59");
        assert_eq!(format_duration(3_600.0), "1:00:00");
        assert_eq!(format_duration(3_725.0), "1:02:05");
        assert_eq!(format_duration(-5.0), "00:00");
        assert_eq!(format_duration(f64::NAN), "00:00");
    }
}
