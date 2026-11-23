import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Rune-aware test setup. Two things make `.svelte.ts` controllers testable:
//   1. the svelte plugin compiles `$state`/`$derived`/`$effect` in
//      `.svelte.ts` modules (without it, the runes are undefined macros);
//   2. the `browser` resolve condition makes vite pull svelte's *client*
//      reactivity runtime instead of the SSR build, so $state proxies and
//      derived recomputation behave under test exactly as they do in the app.
// This is the vite-plugin-svelte-recommended vitest wiring.
export default defineConfig(({ mode }) => ({
  plugins: [svelte({ hot: false })],
  resolve: {
    conditions: mode === 'test' ? ['browser'] : []
  },
  test: {
    // src/shared pure logic + renderer .svelte.ts controllers + main-process
    // logic (paced rate limiter, musicbrainz/slskd with stubbed fetch)
    include: [
      'src/shared/**/*.test.ts',
      'src/renderer/src/**/*.test.ts',
      'src/main/**/*.test.ts'
    ]
  }
}))
