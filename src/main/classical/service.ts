import { app, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AlbumCredits } from '../../shared/plex.js'
import type {
  ClassicalOwnedAlbumInput,
  ClassicalCorrection,
  ClassicalCorrectionCommand,
  ClassicalCorrectionDocument,
  ClassicalSearchArgs
} from '../../shared/classical-api.js'
import { ClassicalDatabase, type CachedClassicalRelease } from './database.js'
import { getValue } from '../store.js'
import { resolveServerContext } from '../plex/connection.js'
import { getAlbumDetail } from '../plex/library.js'
import { getAlbumCreditsCached } from '../musicbrainz.js'

const CREDITS_BUCKET = 'album-credits-v5'
const OPEN_OPUS_DUMP_URL = 'https://api.openopus.org/work/dump.json'
const OPEN_OPUS_REFRESH_MS = 30 * 24 * 60 * 60 * 1000
let database: ClassicalDatabase | null = null
let initializing: Promise<ClassicalDatabase> | null = null
let syncTask: Promise<void> | null = null
let currentSyncItem: string | null = null
let syncGeneration = 0

function correctionPath(): string {
  return join(app.getPath('userData'), 'classical-overrides-v1.json')
}

function librarySnapshotPath(): string {
  return join(app.getPath('userData'), 'classical-library-v1.json')
}

async function readCorrectionDocument(): Promise<ClassicalCorrectionDocument> {
  try {
    const parsed = JSON.parse(await readFile(correctionPath(), 'utf8')) as ClassicalCorrectionDocument
    if (parsed.version === 1 && Array.isArray(parsed.corrections)) return parsed
  } catch { /* First run or a corrupt optional journal. */ }
  return { version: 1, exportedAt: new Date(0).toISOString(), corrections: [] }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await rename(temp, path)
}

async function replayCorrections(db: ClassicalDatabase): Promise<void> {
  const document = await readCorrectionDocument()
  for (const correction of document.corrections) {
    if (!correction.undoneAt && !db.hasCorrection(correction.id)) db.applyCorrection(correction.command, { id: correction.id, createdAt: correction.createdAt })
  }
}

function broadcast(channel: 'classical:sync-progress' | 'classical:catalog-changed', payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

function seedCandidates(): string[] {
  return [
    join(process.resourcesPath, 'classical', 'openopus-work-dump.json.gz'),
    join(app.getAppPath(), 'resources', 'classical', 'openopus-work-dump.json.gz'),
    join(process.cwd(), 'resources', 'classical', 'openopus-work-dump.json.gz')
  ]
}

async function readCachedCredits(): Promise<CachedClassicalRelease[]> {
  const dir = join(app.getPath('userData'), 'mb-cache', CREDITS_BUCKET)
  let files: string[] = []
  try { files = await readdir(dir) } catch { return [] }
  const releases: CachedClassicalRelease[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const envelope = JSON.parse(await readFile(join(dir, file), 'utf8')) as { v: number; d: AlbumCredits | null }
      if (envelope.v === 1 && envelope.d?.classical) releases.push({ ratingKey: file.slice(0, -5), credits: envelope.d })
    } catch {
      // A partial cache write is repairable and must not block the catalog.
    }
  }
  return releases
}

export async function initializeClassicalDatabase(): Promise<ClassicalDatabase> {
  if (database) return database
  if (initializing) return initializing
  initializing = (async () => {
    const db = new ClassicalDatabase(join(app.getPath('userData'), 'classical.sqlite'))
    db.recoverInterruptedSyncJobs()
    if (!db.getSourceVersion()) {
      const seed = seedCandidates().find(existsSync)
      if (seed) db.importOpenOpusFile(seed)
    }
    db.importOwnedCredits(await readCachedCredits(), getValue('preferredServerId'))
    try {
      const albums = JSON.parse(await readFile(librarySnapshotPath(), 'utf8')) as ClassicalOwnedAlbumInput[]
      if (Array.isArray(albums)) db.syncOwnedAlbums(albums)
    } catch { /* The renderer supplies the first snapshot. */ }
    await replayCorrections(db)
    database = db
    void runClassicalSync()
    void refreshOpenOpusIfDue()
    return db
  })()
  try { return await initializing } finally { initializing = null }
}

export async function getClassicalHome() {
  const db = await initializeClassicalDatabase()
  db.importOwnedCredits(await readCachedCredits(), getValue('preferredServerId'))
  return db.getHome()
}

export async function syncClassicalOwnedAlbums(albums: ClassicalOwnedAlbumInput[]) {
  const result = (await initializeClassicalDatabase()).syncOwnedAlbums(albums)
  await writeJsonAtomic(librarySnapshotPath(), albums)
  void runClassicalSync()
  return result
}

export async function searchClassical(args: ClassicalSearchArgs) {
  return (await initializeClassicalDatabase()).search(args)
}

export async function getClassicalComposer(id: string) {
  return (await initializeClassicalDatabase()).getComposer(id)
}

export async function getClassicalWork(id: string) {
  return (await initializeClassicalDatabase()).getWork(id)
}

export async function getClassicalAgent(id: string) {
  return (await initializeClassicalDatabase()).getAgent(id)
}

export async function getClassicalRecording(id: string) {
  return (await initializeClassicalDatabase()).getRecording(id)
}

export async function getClassicalRelease(id: string) {
  return (await initializeClassicalDatabase()).getRelease(id)
}

export async function getClassicalSyncStatus() {
  const status = (await initializeClassicalDatabase()).getSyncStatus()
  return { ...status, current: currentSyncItem, phase: status.phase === 'idle' && syncTask ? 'enriching' as const : status.phase }
}

export async function pauseClassicalSync() {
  const db = await initializeClassicalDatabase()
  db.pauseSyncJobs()
  broadcast('classical:sync-progress', await getClassicalSyncStatus())
  return { ok: true as const }
}

export async function resumeClassicalSync() {
  const db = await initializeClassicalDatabase()
  db.resumeSyncJobs()
  void runClassicalSync()
  return { ok: true as const }
}

export async function retryClassicalSync() {
  const db = await initializeClassicalDatabase()
  const retried = db.retryFailedSyncJobs()
  db.resumeSyncJobs()
  void runClassicalSync()
  return { retried }
}

export async function refreshClassicalSources() {
  return await refreshOpenOpusIfDue(true)
}

async function refreshOpenOpusIfDue(force = false): Promise<{ changed: boolean; version: string | null }> {
  const db = database
  if (!db) return { changed: false, version: null }
  const generation = syncGeneration
  const last = db.getSyncValue('last_openopus_refresh')
  if (!force && last && Date.now() - Date.parse(last) < OPEN_OPUS_REFRESH_MS) {
    return { changed: false, version: db.getSourceVersion() }
  }
  try {
    const response = await fetch(OPEN_OPUS_DUMP_URL, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Open Opus returned ${response.status}`)
    const dump = await response.json() as { status?: { version?: string }; composers?: unknown[] }
    if (!Array.isArray(dump.composers) || dump.composers.length < 200) throw new Error('Open Opus dump failed validation')
    if (generation !== syncGeneration || database !== db) return { changed: false, version: null }
    const previous = db.getSourceVersion()
    db.importOpenOpus(dump as Parameters<ClassicalDatabase['importOpenOpus']>[0])
    const version = db.getSourceVersion()
    if (version !== previous) broadcast('classical:catalog-changed', { reason: 'openopus-refreshed' })
    return { changed: version !== previous, version }
  } catch (err) {
    console.warn('[classical] Open Opus refresh deferred:', err)
    return { changed: false, version: generation === syncGeneration && database === db ? db.getSourceVersion() : null }
  }
}

async function runClassicalSync(): Promise<void> {
  if (syncTask || !database || database.syncPaused()) return
  const db = database
  const generation = syncGeneration
  const task = (async () => {
    while (generation === syncGeneration && database === db && !db.syncPaused()) {
      const job = db.claimNextSyncJob()
      if (!job) break
      currentSyncItem = `${job.artist} — ${job.title}`
      broadcast('classical:sync-progress', await getClassicalSyncStatus())
      try {
        const server = await resolveServerContext(job.serverId)
        const detail = await getAlbumDetail(server, job.ratingKey)
        const credits = await getAlbumCreditsCached(
          job.ratingKey, job.artist, job.title, job.year, [...detail.guids], detail.tracks
        )
        if (generation !== syncGeneration || database !== db) return
        if (credits?.classical?.matchedTracks) {
          db.importOwnedCredits([{ ratingKey: job.ratingKey, credits }], job.serverId)
        }
        db.completeSyncJob(job.id)
        broadcast('classical:catalog-changed', { reason: 'release-enriched', ratingKey: job.ratingKey })
      } catch (err) {
        if (generation !== syncGeneration || database !== db) return
        const message = err instanceof Error ? err.message : String(err)
        db.failSyncJob(job.id, message, job.attempts)
      }
    }
  })()
  syncTask = task
  try {
    await task
  } finally {
    if (syncTask === task) {
      currentSyncItem = null
      syncTask = null
      if (generation === syncGeneration && database === db) {
        const status = db.getSyncStatus()
        broadcast('classical:sync-progress', { ...status, current: null })
      }
    }
  }
}

export async function listClassicalReviewCandidates(limit?: number) {
  return (await initializeClassicalDatabase()).listReviewCandidates(limit)
}

export async function applyClassicalCorrection(command: ClassicalCorrectionCommand) {
  const correction = (await initializeClassicalDatabase()).applyCorrection(command)
  const document = await readCorrectionDocument()
  document.corrections.push(correction)
  document.exportedAt = new Date().toISOString()
  await writeJsonAtomic(correctionPath(), document)
  broadcast('classical:catalog-changed', { reason: 'correction-applied' })
  return correction
}

export async function undoClassicalCorrection(id: string): Promise<{ ok: true }> {
  const document = await readCorrectionDocument()
  const correction = document.corrections.find((entry) => entry.id === id)
  if (!correction) throw new Error('Classical correction not found')
  correction.undoneAt = new Date().toISOString()
  document.exportedAt = correction.undoneAt
  await writeJsonAtomic(correctionPath(), document)
  await rebuildClassicalDatabase()
  broadcast('classical:catalog-changed', { reason: 'correction-undone' })
  return { ok: true }
}

export async function exportClassicalCorrections(): Promise<ClassicalCorrectionDocument> {
  const document = await readCorrectionDocument()
  return { ...document, exportedAt: new Date().toISOString() }
}

export async function importClassicalCorrections(document: ClassicalCorrectionDocument): Promise<{ imported: number }> {
  if (document.version !== 1 || !Array.isArray(document.corrections)) throw new Error('Unsupported classical correction document')
  await writeJsonAtomic(correctionPath(), { ...document, exportedAt: new Date().toISOString() })
  await rebuildClassicalDatabase()
  broadcast('classical:catalog-changed', { reason: 'corrections-imported' })
  return { imported: document.corrections.length }
}

async function rebuildClassicalDatabase(): Promise<void> {
  syncGeneration++
  const previousSync = syncTask
  if (previousSync) await previousSync
  database?.close()
  database = null
  const path = join(app.getPath('userData'), 'classical.sqlite')
  await Promise.all([rm(path, { force: true }), rm(`${path}-wal`, { force: true }), rm(`${path}-shm`, { force: true })])
  await initializeClassicalDatabase()
}

export async function refreshClassicalOwnedCredits(): Promise<void> {
  if (!database) return
  database.importOwnedCredits(await readCachedCredits(), getValue('preferredServerId'))
}

export function closeClassicalDatabase(): void {
  syncGeneration++
  database?.close()
  database = null
}
