import { BrowserWindow } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import type { MiniPlayerState } from '../shared/ipc-contract.js'
import { getValue } from './store.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

let miniWin: BrowserWindow | null = null
// Latest state relayed from the main window — replayed to the mini window
// when it (re)opens so it doesn't sit blank until the next 2.5s poll.
let lastState: MiniPlayerState | null = null
// Session-remembered position so re-toggling puts the pill back where the
// user dragged it.
let lastBounds: { x: number; y: number } | null = null

function notifyOpenChanged(open: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== miniWin && !win.isDestroyed()) win.webContents.send('mini:open-changed', open)
  }
}

export function isMiniWindow(win: BrowserWindow | null): boolean {
  return win !== null && win === miniWin
}

export function pushMiniState(state: MiniPlayerState | null): void {
  lastState = state
  if (miniWin && !miniWin.isDestroyed()) miniWin.webContents.send('mini:state', state)
}

// Show/focus every non-mini window — the "expand" affordance in the pill.
export function focusMainWindow(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win !== miniWin && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  }
}

export function toggleMiniPlayer(): boolean {
  if (miniWin && !miniWin.isDestroyed()) {
    miniWin.close()
    return false
  }

  miniWin = new BrowserWindow({
    width: 360,
    height: 84,
    ...(lastBounds ?? {}),
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: getValue('windowBackground'),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })
  // 'floating' keeps it above normal windows but below panels/menus.
  miniWin.setAlwaysOnTop(true, 'floating')

  miniWin.on('ready-to-show', () => miniWin?.show())
  miniWin.webContents.on('did-finish-load', () => {
    miniWin?.webContents.send('mini:state', lastState)
  })
  miniWin.on('close', () => {
    const b = miniWin?.getBounds()
    if (b) lastBounds = { x: b.x, y: b.y }
  })
  miniWin.on('closed', () => {
    miniWin = null
    notifyOpenChanged(false)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void miniWin.loadURL(`${process.env.ELECTRON_RENDERER_URL}#mini`)
  } else {
    void miniWin.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'mini' })
  }

  notifyOpenChanged(true)
  return true
}
