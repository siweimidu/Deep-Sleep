/* tslint:disable */
/* eslint-disable */

export function getRegionName(code: string, locale: string): string;

export function normalizeLocation(value: string): string;

/**
 * `normalizeLocation` over the binary wire.
 */
export function normalizeLocationWire(len: number): number;

/**
 * The address of an argument buffer of `len` bytes.
 */
export function rustAnythingWireIn(len: number): number;

/**
 * This module's memory, where `index.cjs` reads and writes the wire buffers.
 */
export function rustAnythingWireMemory(): any;

/**
 * The address of the last result.
 */
export function rustAnythingWireOut(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly getRegionName: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly normalizeLocation: (a: number, b: number) => [number, number, number, number];
    readonly normalizeLocationWire: (a: number) => [number, number, number];
    readonly rustAnythingWireIn: (a: number) => number;
    readonly rustAnythingWireMemory: () => any;
    readonly rustAnythingWireOut: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
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
