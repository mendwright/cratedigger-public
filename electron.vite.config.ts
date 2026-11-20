import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'
import { existsSync, readFileSync } from 'fs'

// Public "friends" build: PUBLIC_BUILD=1 strips soulseek / triage / library
// writes (see src/shared/build-flags.ts). Injected into all three processes.
const PUBLIC_BUILD = JSON.stringify(process.env.PUBLIC_BUILD === '1')

// Household defaults for the personal build (scripts/ never reaches the public
// mirror). Lets the living-room player work from a Mac login whose Settings
// were never filled in — e.g. a guest account with no SSH key for the Pi.
const privateDefaultsPath = resolve(__dirname, 'scripts/private-defaults.json')
const privateDefaults: { kioskUrl?: string } =
  process.env.PUBLIC_BUILD !== '1' && existsSync(privateDefaultsPath)
    ? JSON.parse(readFileSync(privateDefaultsPath, 'utf8'))
    : {}
const DEFAULT_KIOSK_URL = JSON.stringify(privateDefaults.kioskUrl ?? '')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: { __PUBLIC_BUILD__: PUBLIC_BUILD, __DEFAULT_KIOSK_URL__: DEFAULT_KIOSK_URL },
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
