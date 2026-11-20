// Compile-time build flags, shared across main / preload / renderer.
//
// `__PUBLIC_BUILD__` is injected by `electron.vite.config.ts`'s `define`
// (sourced from `process.env.PUBLIC_BUILD === '1'` at build/dev time).
// When true, this is the public "friends" build: soulseek, triage/tagger,
// and every library-write feature is gated off — the source stays present
// but never renders, registers, or fires.
//
// The `typeof` guard keeps this safe under vitest, where `define` is not
// applied and the identifier is undeclared at runtime (typeof on an
// undeclared identifier returns 'undefined' rather than throwing).
declare const __PUBLIC_BUILD__: boolean

export const PUBLIC_BUILD: boolean =
  typeof __PUBLIC_BUILD__ === 'boolean' ? __PUBLIC_BUILD__ : false
