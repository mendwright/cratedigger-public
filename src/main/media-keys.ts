import type { BrowserWindow } from 'electron'

export type MediaKeyAction = 'play' | 'pause' | 'playPause' | 'next' | 'previous' | 'seek'

export interface MediaMetadata {
  title?: string
  artist?: string
  album?: string
  albumArt?: string
  state?: 'playing' | 'paused' | 'stopped'
  currentTime?: number
  duration?: number
}

interface MediaServiceInstance {
  startService(): void
  stopService(): Promise<void> | void
  on(action: 'play' | 'pause' | 'playPause' | 'next' | 'previous', cb: () => void): void
  on(action: 'seek', cb: (ms: number) => void): void
  setMetaData(meta: MediaMetadata): void
}

interface MediaServiceCtor {
  new (): MediaServiceInstance
}

let service: MediaServiceInstance | null = null
let attachedWindow: BrowserWindow | null = null

// macOS routes media keys (F7/F8/F9 + Touch Bar transport) to whichever app
// most recently published `MPNowPlayingInfoCenter.playbackState = .playing`.
// Without this binding, the keys fall through to Apple Music's launchd-bound
// handler. Keep `setMediaMetadata` calls flowing — registration alone is not
// enough to claim the route from Apple Music.
export function startMediaKeys(win: BrowserWindow): void {
  if (process.platform !== 'darwin') return
  if (service) return
  let MediaService: MediaServiceCtor
  try {
    const mod = require('@arcanewizards/electron-media-service') as
      | { default: MediaServiceCtor }
      | MediaServiceCtor
    MediaService = (mod as { default?: MediaServiceCtor }).default ?? (mod as MediaServiceCtor)
  } catch (err) {
    console.error('[media-keys] failed to load native module:', err)
    return
  }
  try {
    service = new MediaService()
    service.startService()
    attachedWindow = win
    const send = (action: MediaKeyAction, payload?: number): void => {
      if (attachedWindow && !attachedWindow.isDestroyed()) {
        attachedWindow.webContents.send('media-keys:command', { action, payload })
      }
    }
    service.on('play', () => send('play'))
    service.on('pause', () => send('pause'))
    service.on('playPause', () => send('playPause'))
    service.on('next', () => send('next'))
    service.on('previous', () => send('previous'))
    service.on('seek', (ms: number) => send('seek', ms))
  } catch (err) {
    console.error('[media-keys] failed to start service:', err)
    service = null
    attachedWindow = null
  }
}

export function stopMediaKeys(): void {
  if (!service) return
  try {
    void service.stopService()
  } catch (err) {
    console.error('[media-keys] stopService failed:', err)
  }
  service = null
  attachedWindow = null
}

export function setMediaMetadata(meta: MediaMetadata): void {
  if (!service) return
  try {
    service.setMetaData(meta)
  } catch (err) {
    console.error('[media-keys] setMetaData failed:', err)
  }
}
