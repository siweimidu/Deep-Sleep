/* tslint:disable */
/* eslint-disable */

/**
 * 电平包络。
 */
export class WasmLevelSmoother {
    free(): void;
    [Symbol.dispose](): void;
    constructor(attack_ms: number, release_ms: number);
    reset(): void;
    step(raw: number, dt_ms: number): number;
    readonly value: number;
}

/**
 * 判停器：TS 每帧喂 (level, now)，拿 0..3 的信号。
 */
export class WasmTurnDetector {
    free(): void;
    [Symbol.dispose](): void;
    constructor(speech_level: number, silence_ms: number, min_speech_ms: number, grace_ms: number);
    push(level: number, now_ms: number): number;
    reset(): void;
}

export function format_duration_js(seconds: number): string;

/**
 * 阶段迁移：给的是编码值，返回也是编码值。
 */
export function next_phase_code(phase_code: number, event_code: number): number;

/**
 * 光球参数：[core, glow, halo, spin, breathe]
 */
export function orb_params_js(level: number, phase_code: number, t_ms: number): Float64Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmlevelsmoother_free: (a: number, b: number) => void;
    readonly __wbg_wasmturndetector_free: (a: number, b: number) => void;
    readonly format_duration_js: (a: number) => [number, number];
    readonly next_phase_code: (a: number, b: number) => number;
    readonly orb_params_js: (a: number, b: number, c: number) => [number, number];
    readonly wasmlevelsmoother_new: (a: number, b: number) => number;
    readonly wasmlevelsmoother_reset: (a: number) => void;
    readonly wasmlevelsmoother_step: (a: number, b: number, c: number) => number;
    readonly wasmlevelsmoother_value: (a: number) => number;
    readonly wasmturndetector_new: (a: number, b: number, c: number, d: number) => number;
    readonly wasmturndetector_push: (a: number, b: number, c: number) => number;
    readonly wasmturndetector_reset: (a: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
