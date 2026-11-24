// Resolves a TypeScript project's `./x.js` specifiers to the `./x.ts` file that actually exists.
//
// The app is written with `.js` specifiers (required by its ESM build), so Node cannot load those
// modules from source: `./errors.js` does not exist on disk. Node's own type stripping handles the
// syntax, this hook handles the resolution. Registered by register-ts.mjs; no dependency needed.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (error) {
    if (specifier.endsWith('.js') && error?.code === 'ERR_MODULE_NOT_FOUND') {
      return next(`${specifier.slice(0, -3)}.ts`, context)
    }
    throw error
  }
}
