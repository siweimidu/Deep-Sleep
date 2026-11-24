// Recording shim for `rust-anything record`.
//
// The units under port are pure functions, but their import graph reaches module-scope browser
// references, so Node cannot load the original at all and nothing can be recorded.
//
// 1. `src/app/android.ts:34` reads `window.DeepSeekAndroid` at module scope. Node has no `window`.
//    Aliasing `window` to the global object reproduces the browser shape without faking behaviour:
//    every `window.X` that is not installed reads `undefined`, as in a browser with no bridge.
// 2. `src/services/api/client.ts:13` reads `__API_ORIGIN__`, which rspack injects at build time
//    (`rspack.config.ts`: `apiOrigin = 'https://api.deepseek.com'`). The same value is set here.
globalThis.window ??= globalThis
globalThis.__API_ORIGIN__ ??= 'https://api.deepseek.com'
