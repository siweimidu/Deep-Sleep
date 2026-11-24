// Registers rust/ts-resolve.mjs so benchmarks can import the app's TypeScript sources directly:
//   node --import ./rust/register-ts.mjs rust/bench-archive.mjs
import { register } from 'node:module'

register('./ts-resolve.mjs', import.meta.url)
