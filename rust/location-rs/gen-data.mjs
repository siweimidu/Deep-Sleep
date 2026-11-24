// Writes `src/port/data.rs` from `src/services/locationData.ts` and the runtime's `Intl.DisplayNames`.
//
// The tables are copied as they are: same entries, same order, same multiplicity. The region names
// are not in the source at all — `location.ts` asks `Intl.DisplayNames` at runtime — so they are
// read here from the same engine that records the cases, and the file says so.
//
//   node gen-data.mjs          # from rust/location-rs
import { writeFileSync } from 'node:fs'

const data = await import('../../src/services/locationData.ts')
const { provinceNames, cityNames, regionCodes, regionNameOverrides } = data

const quote = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const row = (...fields) => `    (${fields.map(quote).join(', ')}),`

const display = (locale) => new Intl.DisplayNames([locale], { type: 'region' })
const zh = display('zh-CN')
const en = display('en-US')

const regions = regionCodes.map((code) => {
  const name = [zh.of(code), en.of(code)]
  for (const n of name) {
    if (typeof n !== 'string') throw new Error(`no ${code} name: ${String(n)}`)
  }
  return row(code, name[0], name[1])
})

const provinces = Object.entries(provinceNames).map(([code, name]) => row(code, name))
const cities = Object.entries(cityNames).map(([code, name]) => row(code, name))
const overrides = Object.entries(regionNameOverrides).flatMap(([locale, names]) =>
  Object.entries(names).map(([code, name]) => row(locale, code, name)),
)

const rust = `//! The tables of \`src/services/locationData.ts\`, and the region names \`Intl.DisplayNames\` gives
//! for them.
//!
//! Written by \`gen-data.mjs\`; do not edit. Order and multiplicity are the source's.
//!
//! The names in \`REGIONS\` are not in the source: \`location.ts:20\` builds them from
//! \`Intl.DisplayNames\`, which is CLDR data inside the JS engine. They are captured from the engine
//! that records the cases, so a different CLDR version can spell a name differently.

/// \`regionCodes\`, with \`Intl.DisplayNames(['zh-CN'|'en-US'], { type: 'region' }).of(code)\`.
pub static REGIONS: &[(&str, &str, &str)] = &[
${regions.join('\n')}
];

/// \`provinceNames\`, as \`(code, name)\`.
pub static PROVINCES: &[(&str, &str)] = &[
${provinces.join('\n')}
];

/// \`regionNameOverrides\`, as \`(locale, code, name)\`.
pub static OVERRIDES: &[(&str, &str, &str)] = &[
${overrides.join('\n')}
];

/// \`cityNames\`, as \`(code, name)\`.
pub static CITIES: &[(&str, &str)] = &[
${cities.join('\n')}
];
`

writeFileSync(new URL('./src/port/data.rs', import.meta.url), rust)
console.log(
  `regions ${regions.length}, provinces ${provinces.length}, cities ${cities.length}, ` +
    `overrides ${overrides.length}, ${rust.split('\n').length} lines`,
)
