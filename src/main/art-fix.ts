import { BrowserWindow } from 'electron'
import type {
  ArtFixAcceptResult,
  ArtFixCandidate,
  ArtFixLogEntry,
  ArtFixQueue,
  ArtFixQueueItem,
  ArtFixScanProgress,
  PlexAlbum,
  ServerContext
} from '../shared/plex.js'
import { splitAlbumMbids } from '../shared/guid.js'
import { isAltEdition, rankCandidates } from '../shared/art-fix.js'
import { BackgroundJobRunner } from './background-job.js'
import { resolveServerContext } from './plex/connection.js'
import { listMusicSections, listAllAlbums } from './plex/library.js'
import {
  listAlbumPosters,
  selectAlbumPoster,
  uploadAlbumPoster,
  measureImage
} from './plex/posters.js'
import { searchDeezerAlbumCovers, searchDeezerByTitle } from './deezer.js'
import { searchITunesAlbumCovers } from './itunes.js'
import { getReleaseFrontCovers } from './coverart.js'
import {
  appendArtFixLog,
  clearArtFixDecision,
  getArtFixProgress,
  getPlexAdminToken,
  popArtFixLog,
  setArtFixDecision
} from './store.js'
// Bundled 2026-06-21 snapshot (mirror of docs/album-art-fixer/review-queue.json)
// — seeds the work-list and carries the pre-fetched Deezer candidates so the
// review view has something to chew on before any live scan finishes.
import seed from './art-fix-seed.json'

const LOW_RES_THRESHOLD = 1000 // shorter side, px
const SCAN_CONCURRENCY = 8
const MAX_CANDIDATES_MEASURED = 14

// --- seed snapshot ---------------------------------------------------------

interface SeedReviewRow {
  rk: string
  artist: string
  album: string
  short: number
  cand_url: string
  cand_res: number
  deezer_artist: string
  deezer_title: string
  asim: number
  bsim: number
}
interface SeedNoMatchRow {
  rk: string
  artist: string
  album: string
  short: number
}
interface SeedFile {
  review: SeedReviewRow[]
  nomatch: SeedNoMatchRow[]
}

function seedQueueItems(): ArtFixQueueItem[] {
  const s = seed as unknown as SeedFile
  const review = (s.review ?? []).map(
    (r): ArtFixQueueItem => ({
      rk: r.rk,
      artist: r.artist,
      album: r.album,
      year: null,
      short: r.short,
      thumb: null,
      mbid: null,
      seed: {
        candUrl: r.cand_url,
        candRes: r.cand_res,
        deezerArtist: r.deezer_artist,
        deezerTitle: r.deezer_title,
        asim: r.asim,
        bsim: r.bsim
      }
    })
  )
  const nomatch = (s.nomatch ?? []).map(
    (r): ArtFixQueueItem => ({
      rk: r.rk,
      artist: r.artist,
      album: r.album,
      year: null,
      short: r.short,
      thumb: null,
      mbid: null,
      seed: null
    })
  )
  return [...review, ...nomatch]
}

function undecided(items: ArtFixQueueItem[]): ArtFixQueueItem[] {
  const decided = getArtFixProgress()
  return items.filter((it) => !decided[it.rk])
}

// --- live scan -------------------------------------------------------------

const scanJob = new BackgroundJobRunner<ArtFixScanProgress>(
  { running: false, done: 0, total: 0, lowRes: 0, current: null, lastError: null },
  (progress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('artfix:scan-progress', progress)
    }
  }
)

// Cached result of the most recent completed scan this session. The queue
// re-derives from Plex on scan (self-healing) but we don't re-scan on every
// list — the renderer drives scans explicitly.
let lastScan: ArtFixQueue | null = null

export function getArtFixScanProgress(): ArtFixScanProgress {
  return scanJob.getProgress()
}

export function cancelArtFixScan(): void {
  scanJob.stop()
}

async function allAlbums(ctx: ServerContext): Promise<PlexAlbum[]> {
  const sections = await listMusicSections(ctx)
  const out: PlexAlbum[] = []
  for (const section of sections) {
    out.push(...(await listAllAlbums(ctx, section.key)))
  }
  return out
}

// Bounded-concurrency map — measuring thousands of posters serially would take
// many minutes; 8-wide keeps Plex's transcoder comfortable while finishing in
// a fraction of the time.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export async function scanArtFixQueue(
  serverId: string,
  threshold = LOW_RES_THRESHOLD
): Promise<ArtFixQueue> {
  const result = await scanJob.run(
    { done: 0, total: 0, lowRes: 0, current: null, lastError: null },
    async (): Promise<ArtFixQueue> => {
      const ctx = await resolveServerContext(serverId)
      const albums = await allAlbums(ctx)
      const seedByRk = new Map(seedQueueItems().map((it) => [it.rk, it]))
      scanJob.update({ total: albums.length })

      const items: ArtFixQueueItem[] = []
      await mapLimit(albums, SCAN_CONCURRENCY, async (album) => {
        if (scanJob.cancelled) return
        if (album.thumb) {
          try {
            const measured = await measureImage(`${ctx.baseUrl}${album.thumb}`, ctx.token)
            if (measured && measured.short < threshold) {
              const { release } = splitAlbumMbids(album.guids)
              items.push({
                rk: album.ratingKey,
                artist: album.artist,
                album: album.title,
                year: album.year,
                short: measured.short,
                thumb: album.thumb,
                mbid: release,
                seed: seedByRk.get(album.ratingKey)?.seed ?? null
              })
              scanJob.update({ lowRes: items.length })
            }
          } catch (err) {
            scanJob.update({
              lastError: `${album.artist} — ${album.title}: ${err instanceof Error ? err.message : String(err)}`
            })
          }
        }
        scanJob.update({ done: scanJob.progress.done + 1, current: `${album.artist} — ${album.title}` })
      })

      // Worst offenders first.
      items.sort((a, b) => a.short - b.short)
      const queue: ArtFixQueue = { items, source: 'scan', scannedAt: Date.now() }
      lastScan = queue
      return queue
    },
    { current: null }
  )
  // run() returns undefined if a scan was already in flight — hand back the
  // current best-known queue rather than nothing.
  return result ?? listArtFixQueue()
}

export function listArtFixQueue(): ArtFixQueue {
  if (lastScan) {
    return { ...lastScan, items: undecided(lastScan.items) }
  }
  return { items: undecided(seedQueueItems()), source: 'seed', scannedAt: null }
}

// --- candidates ------------------------------------------------------------

async function measured(
  source: ArtFixCandidate['source'],
  url: string,
  thumbUrl: string,
  label: string | null,
  posterRatingKey: string | null,
  token?: string
): Promise<ArtFixCandidate> {
  const m = await measureImage(url, token)
  return {
    source,
    url,
    thumbUrl,
    width: m?.width ?? null,
    height: m?.height ?? null,
    short: m?.short ?? null,
    label,
    posterRatingKey,
    altEdition: isAltEdition(label)
  }
}

export async function getArtFixCandidates(args: {
  serverId: string
  rk: string
  artist: string
  album: string
  mbid: string | null
  // The pre-fetched Deezer cover from the seed (review-queue.json) — matched on
  // title even when the artist diverged, so surface it directly.
  seedUrl?: string | null
}): Promise<ArtFixCandidate[]> {
  const ctx = await resolveServerContext(args.serverId)

  // Existing Plex options (Phase 1 may have left a better one we can re-select
  // with no upload). Skip the currently-selected one — it's the low-res art.
  const posters = (await listAlbumPosters(ctx, args.rk)).filter((p) => !p.selected && p.key)
  const existingTasks = posters.slice(0, 6).map((p) => {
    const isRemote = /^https?:\/\//i.test(p.key)
    // Tokenize Plex-hosted poster URLs so the renderer's <img> can load them
    // (the token rides as a query param — header auth isn't available there).
    const target = isRemote
      ? p.key
      : `${ctx.baseUrl}${p.key}${p.key.includes('?') ? '&' : '?'}X-Plex-Token=${encodeURIComponent(ctx.token)}`
    return () => measured('existing', target, target, p.provider, p.ratingKey)
  })

  let [deezer, itunes] = await Promise.all([
    searchDeezerAlbumCovers(args.artist, args.album),
    searchITunesAlbumCovers(args.artist, args.album, 1400)
  ])
  const caa = args.mbid ? await getReleaseFrontCovers(args.mbid) : []

  // Compilation fallback: a various-artists album's "artist" is a track
  // performer, so the by-artist search whiffs. When nothing came back, retry by
  // album title alone.
  if (deezer.length === 0 && itunes.length === 0) {
    ;[deezer, itunes] = await Promise.all([
      searchDeezerByTitle(args.album),
      searchITunesAlbumCovers('', args.album, 1400)
    ])
  }

  // De-dupe the seed URL against any live deezer hit so it isn't shown twice.
  const seedUrl = args.seedUrl && !deezer.some((d) => d.url === args.seedUrl) ? args.seedUrl : null
  const seedTask = seedUrl
    ? [() => measured('deezer', seedUrl, seedUrl, 'Deezer (seed match)', null)]
    : []

  const remoteTasks: (() => Promise<ArtFixCandidate>)[] = [
    ...seedTask,
    ...deezer.map((c) => () => measured('deezer', c.url, c.thumbUrl, c.label, null)),
    ...itunes.map((c) => () => measured('itunes', c.url, c.thumbUrl, c.label, null)),
    ...caa.map((c) => () => measured('caa', c.url, c.thumbUrl, c.label, null))
  ]

  const tasks = [...existingTasks, ...remoteTasks].slice(0, MAX_CANDIDATES_MEASURED)
  const cands = await Promise.all(tasks.map((t) => t()))
  return rankCandidates(cands)
}

// --- apply / revert --------------------------------------------------------

// Poster writes need server-owner rights. When a Plex admin token is configured
// (Settings), use it so the app can edit cover art while signed in as a
// read-only account (e.g. the shop). Otherwise fall back to the session token.
function writeCtx(ctx: ServerContext): ServerContext {
  const admin = getPlexAdminToken()
  return admin ? { ...ctx, token: admin } : ctx
}

export async function acceptArtFix(args: {
  serverId: string
  rk: string
  candidate: ArtFixCandidate
}): Promise<ArtFixAcceptResult> {
  const ctx = await resolveServerContext(args.serverId)
  const current = (await listAlbumPosters(ctx, args.rk)).find((p) => p.selected) ?? null

  const usingExisting = args.candidate.source === 'existing' && !!args.candidate.posterRatingKey

  // Log BEFORE applying so a crash mid-write still leaves a revertable record.
  appendArtFixLog({
    rk: args.rk,
    prevRatingKey: current?.ratingKey ?? null,
    newUrl: usingExisting ? null : args.candidate.url,
    newRatingKey: usingExisting ? args.candidate.posterRatingKey : null,
    source: args.candidate.source,
    at: Date.now()
  })

  const wctx = writeCtx(ctx)
  if (usingExisting) {
    await selectAlbumPoster(wctx, args.rk, args.candidate.posterRatingKey as string)
  } else {
    await uploadAlbumPoster(wctx, args.rk, args.candidate.url)
  }
  setArtFixDecision(args.rk, 'accepted')
  return { rk: args.rk, newShort: args.candidate.short }
}

export function skipArtFix(rk: string): void {
  setArtFixDecision(rk, 'skipped')
}

export async function revertLastArtFix(
  serverId: string
): Promise<{ ok: true; reverted: ArtFixLogEntry | null }> {
  const entry = popArtFixLog()
  if (!entry) return { ok: true, reverted: null }
  if (entry.prevRatingKey) {
    const ctx = await resolveServerContext(serverId)
    await selectAlbumPoster(writeCtx(ctx), entry.rk, entry.prevRatingKey)
  }
  clearArtFixDecision(entry.rk)
  return { ok: true, reverted: entry }
}
