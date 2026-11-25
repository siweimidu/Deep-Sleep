// call-rs 与 TS 回退逐值对照：两份实现不允许漂移。
import { readFileSync } from 'node:fs'
import { fallback } from '../src/rust-core/call.ts'

const wasm = await import('../rust/call-rs/pkg/call_rs.js')
const bytes = readFileSync('rust/call-rs/pkg/call_rs_bg.wasm')
await wasm.default({ module_or_path: bytes })

let failed = 0
let checked = 0
const check = (name, ok, detail = '') => {
  checked += 1
  if (!ok) {
    failed += 1
    console.log('  ✗', name, detail)
  }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

// 1. 时长
for (const value of [0, 1, 9, 59, 60, 61, 599, 600, 3599, 3600, 3725, 86_400, -5, 1.9]) {
  check(
    `formatDuration(${value})`,
    wasm.format_duration_js(value) === fallback.formatDuration(value),
    `${wasm.format_duration_js(value)} vs ${fallback.formatDuration(value)}`
  )
}
check('formatDuration(NaN)', wasm.format_duration_js(Number.NaN) === fallback.formatDuration(Number.NaN))

// 2. 阶段迁移：4 阶段 × 7 事件全组合
for (let phase = 0; phase < 4; phase += 1) {
  for (let event = 0; event < 7; event += 1) {
    check(
      `nextPhase(${phase},${event})`,
      wasm.next_phase_code(phase, event) === fallback.nextPhase(phase, event),
      `${wasm.next_phase_code(phase, event)} vs ${fallback.nextPhase(phase, event)}`
    )
  }
}

// 3. 光球参数：电平 × 阶段 × 时间
for (let phase = 0; phase < 4; phase += 1) {
  for (const level of [0, 0.02, 0.045, 0.2, 0.5, 0.77, 1]) {
    for (const t of [0, 137, 900, 2600, 12_345]) {
      const rust = wasm.orb_params_js(level, phase, t)
      const ts = fallback.orbParams(level, phase, t)
      check(
        `orbParams(${level},${phase},${t})`,
        near(rust[0], ts.core) && near(rust[1], ts.glow) && near(rust[2], ts.halo) && near(rust[3], ts.spin) && near(rust[4], ts.breathe),
        `${Array.from(rust)} vs ${JSON.stringify(ts)}`
      )
    }
  }
}

// 4. 判停：随机电平序列（时间单调递增）
const config = { speechLevel: 0.045, silenceMs: 620, minSpeechMs: 260, graceMs: 220 }
let seed = 12_345
const random = () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
  return seed / 2_147_483_648
}
for (let round = 0; round < 40; round += 1) {
  const rustDetector = new wasm.WasmTurnDetector(
    config.speechLevel,
    config.silenceMs,
    config.minSpeechMs,
    config.graceMs
  )
  const tsDetector = fallback.turnDetector(config)
  let now = 0
  for (let step = 0; step < 60; step += 1) {
    now += 16 + Math.floor(random() * 120)
    const level = random() < 0.35 ? random() : 0.001
    check(
      `turn round${round} step${step}`,
      rustDetector.push(level, now) === tsDetector.push(level, now),
      `rust=${rustDetector.push(level, now)}`
    )
  }
  rustDetector.reset()
  tsDetector.reset()
}

// 5. 电平包络
for (const [attack, release] of [
  [90, 260],
  [1, 1],
  [0, 0],
  [500, 60],
]) {
  const rustSmoother = new wasm.WasmLevelSmoother(attack, release)
  const tsSmoother = fallback.levelSmoother(attack, release)
  let dt = 8
  for (let step = 0; step < 80; step += 1) {
    dt = 4 + Math.floor(random() * 40)
    const raw = random() < 0.5 ? random() : 0
    const a = rustSmoother.step(raw, dt)
    const b = tsSmoother.step(raw, dt)
    check(`smoother(${attack},${release}) step${step}`, near(a, b, 1e-9), `${a} vs ${b}`)
  }
}

console.log(`PARITY ${checked} cases, ${failed} failed`)
console.log(failed === 0 ? 'TS 与 wasm 完全一致' : 'FAILED')
process.exit(failed === 0 ? 0 : 1)
