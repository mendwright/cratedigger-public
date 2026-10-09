import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

// Public "friends" build: PUBLIC_BUILD=1 strips soulseek / triage / library
// writes (see src/shared/build-flags.ts). Injected into all three processes.
const PUBLIC_BUILD = JSON.stringify(process.env.PUBLIC_BUILD === '1')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: { __PUBLIC_BUILD__: PUBLIC_BUILD },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    define: { __PUBLIC_BUILD__: PUBLIC_BUILD },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    define: { __PUBLIC_BUILD__: PUBLIC_BUILD },
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [svelte()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
})
