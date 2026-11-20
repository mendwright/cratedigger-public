import { app } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Accolade } from '../shared/accolades.js'
import { getTaggerApiKey, getTaggerUrl } from './store.js'

// Critics' picks come from the tagger (GET /accolades, see
// service/app/accolades.py). They change at most daily, so: one fetch per
// launch-ish (6h memory TTL), and a copy on disk so covers keep their
// stickers when the tagger is unreachable (off the tailnet, box down).
// No tagger configured → empty list; the feature just stays quiet.

const TTL_MS = 6 * 60 * 60 * 1000

let memo: { at: number; entries: Accolade[] } | null = null
let inflight: Promise<Accolade[]> | null = null

function cachePath(): string {
  return join(app.getPath('userData'), 'accolades-cache.json')
}

function readDisk(): Accolade[] {
  try {
    const doc = JSON.parse(readFileSync(cachePath(), 'utf8')) as { entries?: Accolade[] }
    return Array.isArray(doc.entries) ? doc.entries : []
  } catch {
    return []
  }
}

function writeDisk(entries: Accolade[]): void {
  try {
    const tmp = `${cachePath()}.tmp`
    writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), entries }))
    renameSync(tmp, cachePath())
  } catch {
    // A cache that can't be written only costs the offline fallback.
  }
}

async function fetchFromTagger(): Promise<Accolade[]> {
  const base = getTaggerUrl().replace(/\/$/, '')
  const key = getTaggerApiKey()
  if (!base || !key) return readDisk()
  try {
    const r = await fetch(`${base}/accolades`, {
      headers: { 'X-API-Key': key },
      signal: AbortSignal.timeout(15_000)
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const doc = (await r.json()) as { entries?: Accolade[] }
    const entries = Array.isArray(doc.entries) ? doc.entries : []
    writeDisk(entries)
    return entries
  } catch (e) {
    console.warn('[accolades] tagger fetch failed, using disk cache:', (e as Error).message)
    return readDisk()
  }
}

export async function listAccolades(force = false): Promise<Accolade[]> {
  if (!force && memo && Date.now() - memo.at < TTL_MS) return memo.entries
  if (!inflight) {
    inflight = fetchFromTagger()
      .then((entries) => {
        memo = { at: Date.now(), entries }
        return entries
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}
