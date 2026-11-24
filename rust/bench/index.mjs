// Does the translation lookup belong in Rust? `translateFor` / `isTranslationKey` against the TS.
//
//   powershell -NoProfile -ExecutionPolicy Bypass -File rust/build-web-core.ps1 -Crate index-rs -OutDir "$env:TEMP\bench\index-rs"
//   node --import ./rust/register-ts.mjs rust/bench/index.mjs
import { compare, initGlue, installFileFetch, loadTs, summarize } from './lib.mjs'

installFileFetch()
// `src/i18n/index.ts` pulls in the settings store, whose module graph reads `window` on import.
// Node has none; this only makes the module loadable, it runs nothing on the timed path.
globalThis.window = globalThis
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const glue = await initGlue('index-rs')
const { isTranslationKey, translateFor } = await loadTs('src/i18n/index.ts')

// A `serde_json::Value` argument crosses as JSON text; an absent optional argument as the
// `$undefined` marker (ADOPTION.md §4). Results are a plain JS string / boolean.
const UNDEFINED = '{"$undefined":true}'
const viaRust = (locale, key, params = UNDEFINED) =>
  glue.translateFor(locale, JSON.stringify(key), params)

const cases = [
  ['translateFor.zh', () => translateFor('zh-CN', 'welcomeMessageChat250808'), () => viaRust('zh-CN', 'welcomeMessageChat250808')],
  ['translateFor.en', () => translateFor('en-US', 'welcomeMessageChat250808'), () => viaRust('en-US', 'welcomeMessageChat250808')],
  [
    'translateFor.zh.count',
    () => translateFor('zh-CN', 'androidSelectedChats', { count: 3 }),
    () => viaRust('zh-CN', 'androidSelectedChats', JSON.stringify({ count: 3 })),
  ],
  [
    'translateFor.en.count',
    () => translateFor('en-US', 'androidSelectedChats', { count: '7' }),
    () => viaRust('en-US', 'androidSelectedChats', JSON.stringify({ count: '7' })),
  ],
  [
    'translateFor.zh.pair',
    () => translateFor('zh-CN', 'historyImportDoneMixed', { ok: 12, failed: 3 }),
    () => viaRust('zh-CN', 'historyImportDoneMixed', JSON.stringify({ ok: 12, failed: 3 })),
  ],
  // Same template with the optional argument left out: both sides keep "{ok}" as written.
  [
    'translateFor.zh.noParams',
    () => translateFor('zh-CN', 'historyImportDoneMixed'),
    () => viaRust('zh-CN', 'historyImportDoneMixed'),
  ],
  ['isTranslationKey.hit', () => isTranslationKey('androidWelcome'), () => glue.isTranslationKey(JSON.stringify('androidWelcome'))],
  ['isTranslationKey.miss', () => isTranslationKey('toString'), () => glue.isTranslationKey(JSON.stringify('toString'))],
  ['isTranslationKey.nonString', () => isTranslationKey(5), () => glue.isTranslationKey(JSON.stringify(5))],
]

const results = []
for (const [fn, ts, rust] of cases) {
  results.push(
    await compare({
      crate: 'index',
      fn,
      iterations: 5000,
      ts: async () => ts(),
      rust: async () => rust(),
    }),
  )
}
summarize('index', results)
