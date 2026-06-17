import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { registerIpc } from './ipc.js'
import { initAutoUpdater } from './updates.js'
import {
  registerImageProtocolPrivileges,
  registerImageProtocolHandler
} from './imageProxy.js'
import { getValue, migrateSecrets } from './store.js'
import { seedSecretsFromFile } from './secrets-file.js'
import { startMediaKeys, stopMediaKeys } from './media-keys.js'
import { detachInstallerDmg } from './dmg-cleanup.js'

// Local playback ("This Mac") starts an <audio> element after several await
// hops from the Play Album click — Chromium's default policy can interpret
// that as "no user gesture" and reject audio.play(). This is a single-user
// desktop app, not a web page; safe to opt out.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// When the dev parent (electron-vite) restarts and the previous Electron
// child outlives it for a moment, console.warn/error writes to a closed
// stderr fd throw EPIPE and crash the main process with a scary modal.
// Swallow that one specific failure; anything else still surfaces.
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err && err.code === 'EPIPE') return
  throw err
})
process.stderr.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err && err.code === 'EPIPE') return
  throw err
})
process.stdout.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err && err.code === 'EPIPE') return
  throw err
})

registerImageProtocolPrivileges()

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const isDev = !!process.env.ELECTRON_RENDERER_URL

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    // Last-applied theme's paper color (pushed by the renderer on theme
    // change) so the resize gutter and pre-paint frame match the theme.
    backgroundColor: getValue('windowBackground'),
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      // Enables the <webview> tag used by BrowserPane. Webview is technically
      // deprecated by Electron but still supported, and beats WebContentsView
      // here because Svelte controls the layout reactively — WebContentsView
      // would require pixel-rect positioning from the main process on every
      // resize.
      webviewTag: true
    }
  })

  win.on('ready-to-show', () => {
    win.show()
    startMediaKeys(win)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url)
      if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(url)
    } catch {
      // not a valid URL — drop it
    }
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (isDev && process.platform === 'darwin' && app.dock) {
    try {
      const img = nativeImage.createFromPath(join(process.cwd(), 'build', 'icon.png'))
      if (!img.isEmpty()) app.dock.setIcon(img)
    } catch {
      // fall back to default Electron icon
    }
  }
  migrateSecrets()
  seedSecretsFromFile()
  registerImageProtocolHandler()
  registerIpc()
  initAutoUpdater()
  detachInstallerDmg()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopMediaKeys()
})
