import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../shared/updates.js'

// electron-updater is CJS; pull the runtime singleton off the default export.
const { autoUpdater } = electronUpdater

// Auto-update via electron-updater talking to the `cratedigger-releases` GitHub
// repo (configured in package.json's `build.publish`). Replaces the prior
// manual GitHub-releases nag banner. Background download + install-on-quit is
// the safest UX for a music app — never interrupts what the user is doing;
// the next launch boots into the new version automatically. The renderer shows
// "Restart to install" once the bytes are local, so the user can opt in to a
// restart sooner if they want.
//
// Dev mode is a no-op (autoUpdater throws on unpackaged apps). The renderer
// stays in `idle` state and the banner never paints.

let state: UpdateState = { status: 'idle' }

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updates:state', state)
  }
}

function setState(next: UpdateState): void {
  state = next
  broadcast()
}

let initialized = false

/**
 * Wire autoUpdater event handlers and kick off the initial + periodic checks.
 * Safe to call multiple times — only initializes once. No-op outside packaged
 * builds (electron-updater throws when run from `npm run dev`).
 */
export function initAutoUpdater(): void {
  if (initialized) return
  if (!app.isPackaged) return
  initialized = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  autoUpdater.on('update-available', (info) => {
    setState({
      status: 'downloading',
      latest: info.version,
      current: app.getVersion(),
      percent: 0
    })
  })
  autoUpdater.on('download-progress', (p) => {
    if (state.status === 'downloading' || state.status === 'available') {
      setState({
        status: 'downloading',
        latest:
          state.status === 'downloading' || state.status === 'available'
            ? state.latest
            : app.getVersion(),
        current: app.getVersion(),
        percent: typeof p.percent === 'number' ? Math.round(p.percent) : 0
      })
    }
  })
  autoUpdater.on('update-downloaded', (info) => {
    setState({
      status: 'downloaded',
      latest: info.version,
      current: app.getVersion()
    })
  })
  autoUpdater.on('update-not-available', () => {
    // Stay idle; let the next check (or a forced one) try again.
  })
  autoUpdater.on('error', () => {
    // Swallow — banner stays hidden, next check retries. Common in offline
    // mode or when GitHub rate-limits.
  })

  // First check ~15s after launch so it doesn't fight session restore for
  // bandwidth, then every 4h.
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch(() => undefined)
  }, 15_000)
  setInterval(
    () => {
      void autoUpdater.checkForUpdates().catch(() => undefined)
    },
    4 * 60 * 60 * 1000
  )
}

export function getUpdateState(): UpdateState {
  return state
}

/**
 * Force a check now — exposed via IPC for the "check for updates" UI gesture
 * if we ever surface one. Safe to call any time; returns immediately and the
 * event stream drives state.
 */
export async function checkNow(): Promise<void> {
  if (!app.isPackaged) return
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // ignore
  }
}

/**
 * Quit and apply the staged update. Only effective once state is 'downloaded'.
 * In other states this is a no-op — the renderer should only call it from the
 * "restart to install" affordance.
 */
export function installAndRestart(): void {
  if (state.status !== 'downloaded') return
  autoUpdater.quitAndInstall()
}
