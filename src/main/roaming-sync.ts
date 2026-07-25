// Syncs the roaming docs (show marks, Listen Later) with the tagger service
// so they follow the user across machines instead of living in one Mac's
// electron-store. Born 2026-07-09, the night all the pinned shows "vanished"
// because they were sitting on the other MacBook.
//
// Protocol: one round trip per doc. PUT the local doc; the service merges it
// into its copy (same LWW algorithm as src/shared/roaming.ts) and returns the
// merged result, which we store back. Both directions of change ride the same
// call, and a machine returning from weeks offline can't clobber anything.
//
// Failure is always soft: no tagger URL (public build, unconfigured), server
// down, mid-flight error — the local store keeps working and we retry on the
// next trigger. Sync runs on launch, after every mark/Listen Later mutation
// (debounced), and on a slow interval to pick up other machines' writes.

import { PUBLIC_BUILD } from '../shared/build-flags.js'
import type { RoamingDoc, RoamingKey } from '../shared/roaming.js'
import { getRoamingDoc, getTaggerApiKey, getTaggerUrl, setRoamingDoc } from './store.js'

const KEYS: RoamingKey[] = ['show-marks', 'listen-later']
const PUSH_DEBOUNCE_MS = 3_000
const PERIODIC_MS = 15 * 60 * 1000

// Which docs changed locally, so the renderer can refresh the right state.
export type RoamingChange = { keys: RoamingKey[] }

let onLocalChange: ((change: RoamingChange) => void) | null = null
let debounceTimer: NodeJS.Timeout | null = null
let periodicTimer: NodeJS.Timeout | null = null
let syncing = false
let syncQueued = false

function enabled(): boolean {
  return !PUBLIC_BUILD && getTaggerUrl().trim() !== ''
}

async function putDoc(key: RoamingKey, doc: RoamingDoc<unknown>): Promise<RoamingDoc<unknown>> {
  const base = getTaggerUrl().replace(/\/$/, '')
  const apiKey = getTaggerApiKey()
  const r = await fetch(`${base}/roaming/${key}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { 'X-API-Key': apiKey } : {})
    },
    body: JSON.stringify(doc),
    signal: AbortSignal.timeout(10_000)
  })
  if (!r.ok) throw new Error(`roaming PUT ${key}: ${r.status} ${await r.text()}`)
  return (await r.json()) as RoamingDoc<unknown>
}

/** One full sync pass. Serialized: a pass requested while one is in flight
 *  runs once more after it finishes (the local docs may have moved). */
export async function syncRoamingNow(): Promise<void> {
  if (!enabled()) return
  if (syncing) {
    syncQueued = true
    return
  }
  syncing = true
  try {
    const changedKeys: RoamingKey[] = []
    for (const key of KEYS) {
      try {
        const merged = await putDoc(key, getRoamingDoc(key))
        if (merged && typeof merged === 'object' && merged.items) {
          if (setRoamingDoc(key, merged)) changedKeys.push(key)
        }
      } catch (err) {
        console.warn(`roaming-sync: ${key} sync failed:`, err instanceof Error ? err.message : err)
      }
    }
    if (changedKeys.length > 0) onLocalChange?.({ keys: changedKeys })
  } finally {
    syncing = false
    if (syncQueued) {
      syncQueued = false
      void syncRoamingNow()
    }
  }
}

/** Debounced sync — call after every local mark / Listen Later mutation. */
export function scheduleRoamingPush(): void {
  if (!enabled()) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void syncRoamingNow()
  }, PUSH_DEBOUNCE_MS)
}

/** Start background syncing: one pass now, then a slow periodic pull so
 *  another machine's pins show up here without a relaunch. */
export function startRoamingSync(notify: (change: RoamingChange) => void): void {
  onLocalChange = notify
  if (!enabled()) return
  void syncRoamingNow()
  periodicTimer ??= setInterval(() => void syncRoamingNow(), PERIODIC_MS)
  periodicTimer.unref?.()
}
