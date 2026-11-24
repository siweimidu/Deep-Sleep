/* tslint:disable */
/* eslint-disable */

export function formatSize(bytes: number): string;

/**
 * `formatSize` over the binary wire.
 */
export function formatSizeWire(len: number): number;

export function getExtension(name: string): string;

/**
 * `getExtension` over the binary wire.
 */
export function getExtensionWire(len: number): number;

export function getFileExt(name: string): string;

/**
 * `getFileExt` over the binary wire.
 */
export function getFileExtWire(len: number): number;

export function getUploadPurpose(name: string, is_image: boolean): string;

/**
 * `getUploadPurpose` over the binary wire.
 */
export function getUploadPurposeWire(len: number): number;

export function isAcceptedExt(name: string): string;

/**
 * `isAcceptedExt` over the binary wire.
 */
export function isAcceptedExtWire(len: number): number;

export function isImage(mime_type: string): string;

/**
 * `isImage` over the binary wire.
 */
export function isImageWire(len: number): number;

export function resolveMimeType(file: string): string;

/**
 * `resolveMimeType` over the binary wire.
 */
export function resolveMimeTypeWire(len: number): number;

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

export function validateFiles(files: string, current_count: number): string;

/**
 * `validateFiles` over the binary wire.
 */
export function validateFilesWire(len: number): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly formatSize: (a: number) => [number, number, number, number];
    readonly formatSizeWire: (a: number) => [number, number, number];
    readonly getExtension: (a: number, b: number) => [number, number, number, number];
    readonly getExtensionWire: (a: number) => [number, number, number];
    readonly getFileExt: (a: number, b: number) => [number, number, number, number];
    readonly getFileExtWire: (a: number) => [number, number, number];
    readonly getUploadPurpose: (a: number, b: number, c: number) => [number, number, number, number];
    readonly getUploadPurposeWire: (a: number) => [number, number, number];
    readonly isAcceptedExt: (a: number, b: number) => [number, number, number, number];
    readonly isAcceptedExtWire: (a: number) => [number, number, number];
    readonly isImage: (a: number, b: number) => [number, number, number, number];
    readonly isImageWire: (a: number) => [number, number, number];
    readonly resolveMimeType: (a: number, b: number) => [number, number, number, number];
    readonly resolveMimeTypeWire: (a: number) => [number, number, number];
    readonly rustAnythingWireIn: (a: number) => number;
    readonly rustAnythingWireMemory: () => any;
    readonly rustAnythingWireOut: () => number;
    readonly validateFiles: (a: number, b: number, c: number) => [number, number, number, number];
    readonly validateFilesWire: (a: number) => [number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
