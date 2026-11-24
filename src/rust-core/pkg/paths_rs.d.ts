/* tslint:disable */
/* eslint-disable */

export function imagePath(session_id: string, file_id: string, file_name: string): string;

export function parseSessionPath(path: string): string;

/**
 * `parseSessionPath` over the binary wire.
 */
export function parseSessionPathWire(len: number): number;

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

export function sessionFilesDir(session_id: string): string;

export function sessionPath(session_id: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly imagePath: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly parseSessionPath: (a: number, b: number) => [number, number, number, number];
    readonly parseSessionPathWire: (a: number) => [number, number, number];
    readonly rustAnythingWireIn: (a: number) => number;
    readonly rustAnythingWireMemory: () => any;
    readonly rustAnythingWireOut: () => number;
    readonly sessionFilesDir: (a: number, b: number) => [number, number, number, number];
    readonly sessionPath: (a: number, b: number) => [number, number, number, number];
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
