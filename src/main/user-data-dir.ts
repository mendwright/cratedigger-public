import { app } from 'electron'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

// A `npm run dev` window and an installed /Applications/Cratedigger.app used to
// share one userData directory, so both were reading and writing the same
// jayamp.json, the same classical.sqlite and the same mb-cache at once.
//
// electron-store re-reads the file on every write, so this was never the
// wholesale data loss it looks like — but two processes doing read-modify-write
// on one file still race, and a background crawl writing once a second for
// hours beside a live app is exactly the shape that drops updates. Two writers
// on one sqlite file is worse.
//
// So dev gets its own profile directory, and the two builds stop touching each
// other's data.
//
// This module works as a side effect of being imported, which is deliberate:
// store.js constructs its Store at import time and that resolves the userData
// path immediately, so redirecting it from a function called in index.ts's body
// would already be too late. index.ts imports this module first for that
// reason — keep it first.

const isDev = !!process.env.ELECTRON_RENDERER_URL

// Copied once, the first time a dev window runs, so it starts signed in and
// with the real library rather than as a stranger. Only what is expensive or
// impossible to rebuild goes here; classical.sqlite is derived from mb-cache
// plus a bundled seed and recreates itself, and Chromium's own caches are
// Chromium's problem.
const SEED_ENTRIES = [
  'jayamp.json', // settings, auth token, album→MB matches, genre index
  'secrets.key', // without it the copied secrets above can't be decrypted
  'original-years.json',
  'classical-overrides-v1.json',
  'classical-library-v1.json',
  'mb-cache', // ~46MB, but re-fetching it costs hours at MB's 1 req/sec
  'covers'
]

function seedDevProfile(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const entry of SEED_ENTRIES) {
    const source = join(from, entry)
    if (!existsSync(source)) continue
    try {
      cpSync(source, join(to, entry), { recursive: true })
    } catch (err) {
      // A profile missing one seeded file is worth a warning, not a failed
      // launch — everything here is recoverable by signing in again.
      console.warn(`[user-data] could not seed ${entry}:`, err)
    }
  }
}

if (isDev) {
  const shared = app.getPath('userData')
  const devDir = join(dirname(shared), `${basename(shared)}-dev`)
  const firstRun = !existsSync(devDir)
  app.setPath('userData', devDir)
  if (firstRun) {
    seedDevProfile(shared, devDir)
    console.log(`[user-data] seeded a dev profile at ${devDir}`)
  }
}
