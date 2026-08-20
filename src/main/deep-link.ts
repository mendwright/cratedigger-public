import { app, ipcMain, type BrowserWindow, type WebContents } from 'electron'
import { PUBLIC_BUILD } from '../shared/build-flags.js'

// cratedigger:// deep links — the hand-off that lets a browser (via the
// right-click extension living in the bijou repo) wake the app:
//
//   cratedigger://soulseek?q=Artist%20-%20Album
//
// macOS delivers these through 'open-url', which must be listened for before
// app ready to catch a cold launch-via-link; the URL is stashed until the
// renderer announces itself on 'deeplink:ready' (plexState.init subscribes
// first, then pings, so nothing can arrive before a listener exists).
//
// Dev caveat: setAsDefaultProtocolClient registers whichever bundle ran last
// with Launch Services, so a dev run steals the scheme from the installed app
// until the installed app next launches. Harmless, but explains "links open
// the dev window".

let pendingSoulseek: { q: string } | null = null
let readyWc: WebContents | null = null

function handleUrl(
  url: string,
  getWindow: () => BrowserWindow | null,
  ensureWindow: () => void
): void {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return
  }
  if (u.protocol !== 'cratedigger:') return
  // Soulseek is stripped from the friends build; drop the link silently.
  if (u.host !== 'soulseek' || PUBLIC_BUILD) return
  const q = (u.searchParams.get('q') ?? '').trim()
  if (!q) return

  const win = getWindow()
  if (win && readyWc && !readyWc.isDestroyed() && win.webContents === readyWc) {
    if (win.isMinimized()) win.restore()
    win.show()
    app.focus({ steal: true })
    readyWc.send('deeplink:soulseek-search', { q })
  } else {
    // Cold launch (or window closed on macOS): flushes on 'deeplink:ready'
    // once the recreated renderer announces itself.
    pendingSoulseek = { q }
    if (app.isReady() && !win) ensureWindow()
  }
}

export function initDeepLinks(
  getWindow: () => BrowserWindow | null,
  ensureWindow: () => void
): void {
  app.setAsDefaultProtocolClient('cratedigger')
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleUrl(url, getWindow, ensureWindow)
  })
  ipcMain.on('deeplink:ready', (e) => {
    readyWc = e.sender
    if (pendingSoulseek) {
      e.sender.send('deeplink:soulseek-search', pendingSoulseek)
      pendingSoulseek = null
    }
  })
}
