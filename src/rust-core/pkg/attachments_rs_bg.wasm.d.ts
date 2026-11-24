/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const formatSize: (a: number) => [number, number, number, number];
export const formatSizeWire: (a: number) => [number, number, number];
export const getExtension: (a: number, b: number) => [number, number, number, number];
export const getExtensionWire: (a: number) => [number, number, number];
export const getFileExt: (a: number, b: number) => [number, number, number, number];
export const getFileExtWire: (a: number) => [number, number, number];
export const getUploadPurpose: (a: number, b: number, c: number) => [number, number, number, number];
export const getUploadPurposeWire: (a: number) => [number, number, number];
export const isAcceptedExt: (a: number, b: number) => [number, number, number, number];
export const isAcceptedExtWire: (a: number) => [number, number, number];
export const isImage: (a: number, b: number) => [number, number, number, number];
export const isImageWire: (a: number) => [number, number, number];
export const resolveMimeType: (a: number, b: number) => [number, number, number, number];
export const resolveMimeTypeWire: (a: number) => [number, number, number];
export const rustAnythingWireIn: (a: number) => number;
export const rustAnythingWireMemory: () => any;
export const rustAnythingWireOut: () => number;
export const validateFiles: (a: number, b: number, c: number) => [number, number, number, number];
export const validateFilesWire: (a: number) => [number, number, number];
export const __wbindgen_externrefs: WebAssembly.Table;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_start: () => void;
