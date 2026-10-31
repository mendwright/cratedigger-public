import { app } from 'electron'
import { platform, hostname } from 'node:os'
import { getClientIdentifier } from '../store.js'

export const PLEX_PRODUCT = 'Cratedigger'
export const PLEX_DEVICE_NAME = 'Cratedigger'
export const PLEX_PLATFORM = (() => {
  const p = platform()
  if (p === 'darwin') return 'macOS'
  if (p === 'win32') return 'Windows'
  return p
})()

export function plexHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Plex-Product': PLEX_PRODUCT,
    'X-Plex-Version': app.getVersion(),
    'X-Plex-Client-Identifier': getClientIdentifier(),
    'X-Plex-Platform': PLEX_PLATFORM,
    'X-Plex-Device': PLEX_PLATFORM,
    'X-Plex-Device-Name': hostname() || PLEX_DEVICE_NAME,
    Accept: 'application/json'
  }
  if (token) headers['X-Plex-Token'] = token
  return headers
}
