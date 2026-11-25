/* @ts-self-types="./call_rs.d.ts" */

/**
 * 电平包络。
 */
export class WasmLevelSmoother {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmLevelSmootherFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmlevelsmoother_free(ptr, 0);
    }
    /**
     * @param {number} attack_ms
     * @param {number} release_ms
     */
    constructor(attack_ms, release_ms) {
        const ret = wasm.wasmlevelsmoother_new(attack_ms, release_ms);
        this.__wbg_ptr = ret;
        WasmLevelSmootherFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    reset() {
        wasm.wasmlevelsmoother_reset(this.__wbg_ptr);
    }
    /**
     * @param {number} raw
     * @param {number} dt_ms
     * @returns {number}
     */
    step(raw, dt_ms) {
        const ret = wasm.wasmlevelsmoother_step(this.__wbg_ptr, raw, dt_ms);
        return ret;
    }
    /**
     * @returns {number}
     */
    get value() {
        const ret = wasm.wasmlevelsmoother_value(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) WasmLevelSmoother.prototype[Symbol.dispose] = WasmLevelSmoother.prototype.free;

/**
 * 判停器：TS 每帧喂 (level, now)，拿 0..3 的信号。
 */
export class WasmTurnDetector {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmTurnDetectorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmturndetector_free(ptr, 0);
    }
    /**
     * @param {number} speech_level
     * @param {number} silence_ms
     * @param {number} min_speech_ms
     * @param {number} grace_ms
     */
    constructor(speech_level, silence_ms, min_speech_ms, grace_ms) {
        const ret = wasm.wasmturndetector_new(speech_level, silence_ms, min_speech_ms, grace_ms);
        this.__wbg_ptr = ret;
        WasmTurnDetectorFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} level
     * @param {number} now_ms
     * @returns {number}
     */
    push(level, now_ms) {
        const ret = wasm.wasmturndetector_push(this.__wbg_ptr, level, now_ms);
        return ret;
    }
    reset() {
        wasm.wasmturndetector_reset(this.__wbg_ptr);
    }
}
if (Symbol.dispose) WasmTurnDetector.prototype[Symbol.dispose] = WasmTurnDetector.prototype.free;

/**
 * @param {number} seconds
 * @returns {string}
 */
export function format_duration_js(seconds) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.format_duration_js(seconds);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * 阶段迁移：给的是编码值，返回也是编码值。
 * @param {number} phase_code
 * @param {number} event_code
 * @returns {number}
 */
export function next_phase_code(phase_code, event_code) {
    const ret = wasm.next_phase_code(phase_code, event_code);
    return ret;
}

/**
 * 光球参数：[core, glow, halo, spin, breathe]
 * @param {number} level
 * @param {number} phase_code
 * @param {number} t_ms
 * @returns {Float64Array}
 */
export function orb_params_js(level, phase_code, t_ms) {
    const ret = wasm.orb_params_js(level, phase_code, t_ms);
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./call_rs_bg.js": import0,
    };
}

const WasmLevelSmootherFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmlevelsmoother_free(ptr, 1));
const WasmTurnDetectorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmturndetector_free(ptr, 1));

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat64ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('call_rs_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
