import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { homedir } from 'node:os'
import {
  getLastfmApiKey,
  setLastfmApiKey,
  getSlskdApiKey,
  setSlskdApiKey,
  getSlskdUrl,
  setSlskdUrl,
  getTaggerApiKey,
  setTaggerApiKey,
  getTicketmasterApiKey,
  setTicketmasterApiKey,
  getGeniusClientId,
  setGeniusClientId,
  getGeniusClientSecret,
  setGeniusClientSecret
} from './store.js'

// Plain-text JSON backup of user-configurable secrets, deliberately stored
// OUTSIDE the app's userData dir so app reinstalls and the safeStorage→
// file-key migration that zeroed every key during the v0.4 rewrite can't
// ever wipe it again. Lives in ~/.cratedigger so it's easy to find (and to
// point a file-sync tool at, if you want keys to follow you between Macs).
//
// Behavior: at startup, for each entry in this file that is non-empty AND
// whose corresponding store value is currently empty, the store gets
// seeded from the file. Edits in Settings still take precedence — the
// file only fills blanks, it never overwrites set values.
export const SECRETS_BACKUP_PATH = `${homedir()}/.cratedigger/secrets.json`

interface SecretsFile {
  lastfmApiKey?: string
  taggerApiKey?: string
  ticketmasterApiKey?: string
  geniusClientId?: string
  geniusClientSecret?: string
  slskdApiKey?: string
  slskdUrl?: string
}

const TEMPLATE: SecretsFile = {
  lastfmApiKey: '',
  taggerApiKey: '',
  ticketmasterApiKey: '',
  geniusClientId: '',
  geniusClientSecret: '',
  slskdApiKey: '',
  slskdUrl: ''
}

export function seedSecretsFromFile(): void {
  if (!existsSync(SECRETS_BACKUP_PATH)) return
  let data: SecretsFile
  try {
    data = JSON.parse(readFileSync(SECRETS_BACKUP_PATH, 'utf-8')) as SecretsFile
  } catch (err) {
    console.warn('[secrets-file] could not parse backup file:', err)
    return
  }
  let seeded = 0
  if (data.lastfmApiKey && !getLastfmApiKey()) {
    setLastfmApiKey(data.lastfmApiKey)
    seeded++
  }
  if (data.taggerApiKey && !getTaggerApiKey()) {
    setTaggerApiKey(data.taggerApiKey)
    seeded++
  }
  if (data.ticketmasterApiKey && !getTicketmasterApiKey()) {
    setTicketmasterApiKey(data.ticketmasterApiKey)
    seeded++
  }
  if (data.geniusClientId && !getGeniusClientId()) {
    setGeniusClientId(data.geniusClientId)
    seeded++
  }
  if (data.geniusClientSecret && !getGeniusClientSecret()) {
    setGeniusClientSecret(data.geniusClientSecret)
    seeded++
  }
  if (data.slskdApiKey && !getSlskdApiKey()) {
    setSlskdApiKey(data.slskdApiKey)
    seeded++
  }
  if (data.slskdUrl && !getSlskdUrl()) {
    setSlskdUrl(data.slskdUrl)
    seeded++
  }
  if (seeded > 0) {
    console.log(`[secrets-file] seeded ${seeded} blank key(s) from ${SECRETS_BACKUP_PATH}`)
  }
}

// Create the file with an empty template (and the parent dir) if it
// doesn't exist yet. Permissions are 0600 so it's not group/world-readable.
export function ensureBackupFileExists(): string {
  if (!existsSync(SECRETS_BACKUP_PATH)) {
    mkdirSync(dirname(SECRETS_BACKUP_PATH), { recursive: true })
    writeFileSync(SECRETS_BACKUP_PATH, JSON.stringify(TEMPLATE, null, 2) + '\n', {
      mode: 0o600
    })
  }
  return SECRETS_BACKUP_PATH
}

// Mirror every currently-set (decrypted) secret in the store into the
// backup file. The user invokes this from Settings → "Back up keys now"
// once they've entered their keys here. After that, any other machine that
// shares this file (e.g. via a file-sync tool) auto-seeds from it on boot.
//
// Merge semantics: store value wins when non-empty (the live decrypted
// version overwrites whatever was in the file). When the store value is
// empty, the file's existing entry is preserved — this lets the user
// pre-populate a key in the file on machine A and have it stick even
// when running this from machine B where it's not yet set.
export function backUpCurrentKeysToFile(): {
  path: string
  written: number
} {
  ensureBackupFileExists()
  let existing: SecretsFile = {}
  try {
    existing = JSON.parse(readFileSync(SECRETS_BACKUP_PATH, 'utf-8')) as SecretsFile
  } catch {
    // unreadable file gets replaced wholesale
    existing = {}
  }
  const fromStore: SecretsFile = {
    lastfmApiKey: getLastfmApiKey(),
    taggerApiKey: getTaggerApiKey(),
    ticketmasterApiKey: getTicketmasterApiKey(),
    geniusClientId: getGeniusClientId(),
    geniusClientSecret: getGeniusClientSecret(),
    slskdApiKey: getSlskdApiKey(),
    slskdUrl: getSlskdUrl()
  }
  const merged: SecretsFile = {}
  let written = 0
  for (const k of Object.keys(TEMPLATE) as (keyof SecretsFile)[]) {
    const live = fromStore[k]
    const onDisk = existing[k]
    if (live && live.length > 0) {
      merged[k] = live
      if (live !== onDisk) written++
    } else {
      merged[k] = onDisk ?? ''
    }
  }
  writeFileSync(SECRETS_BACKUP_PATH, JSON.stringify(merged, null, 2) + '\n', {
    mode: 0o600
  })
  return { path: SECRETS_BACKUP_PATH, written }
}
