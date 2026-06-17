import { randomUUID } from 'node:crypto'
import { getSlskdUrl, getSlskdApiKey } from './store.js'
import {
  searchReleaseCandidates,
  getReleaseTracks,
  getReleaseCandidate,
  pickEarliestReleaseInGroup,
  listSameCountSiblings
} from './musicbrainz.js'
import type {
  SlskdAlbumCandidate,
  SlskdAlbumGroup,
  SlskdDownloadFile,
  SlskdDownloads,
  SlskdDownloadUser,
  SlskdEnqueueRequest,
  SlskdEnqueueResult,
  SlskdFile,
  SlskdHealth,
  SlskdReleaseHint,
  SlskdSearchResult
} from '../shared/slskd.js'
import { normalizeTitle } from '../shared/title-match.js'

const AUDIO_EXT = new Set(['flac', 'wav', 'm4a', 'ogg', 'aac', 'wma', 'mp3', 'opus'])
const EXT_WEIGHT: Record<string, number> = {
  flac: 1.0,
  wav: 0.85,
  m4a: 0.65,
  aac: 0.65,
  ogg: 0.6,
  opus: 0.6,
  mp3: 0.55,
  wma: 0.4
}
const MIN_SCORE_THRESHOLD = 0.6
const SEARCH_TIMEOUT_MS = 90_000
const POLL_INTERVAL_MS = 1500

function base(): string {
  return getSlskdUrl().replace(/\/$/, '')
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  const key = getSlskdApiKey()
  if (key) h['X-API-Key'] = key
  return h
}

const REQ_TIMEOUT_MS = 30_000

// Injectable fetch so unit tests can stub HTTP without a live slskd.
let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args)

export function _setFetchForTests(f: typeof fetch): void {
  fetchImpl = f
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), REQ_TIMEOUT_MS)
  // If caller passed a signal, abort when either fires.
  const callerSignal = init?.signal
  if (callerSignal) {
    if (callerSignal.aborted) ac.abort()
    else callerSignal.addEventListener('abort', () => ac.abort(), { once: true })
  }
  try {
    const r = await fetchImpl(`${base()}${path}`, {
      ...init,
      headers: { ...headers(), ...(init?.headers ?? {}) },
      signal: ac.signal
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      throw new Error(`slskd ${path}: ${r.status} ${body}`)
    }
    const text = await r.text()
    if (!text) return undefined as T
    return JSON.parse(text) as T
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`slskd ${path}: timed out after ${REQ_TIMEOUT_MS}ms`)
    }
    throw err
  } finally {
    clearTimeout(t)
  }
}

export async function slskdHealth(): Promise<SlskdHealth> {
  const url = getSlskdUrl()
  try {
    // slskd 0.24+ returns version as { current, full, latest, ... }; older
    // builds returned a plain string. Accept either shape.
    const app = await req<{
      version?: string | { current?: string; full?: string }
    }>('/api/v0/application')
    const v = app.version
    const versionStr =
      typeof v === 'string' ? v : v?.current ?? v?.full ?? null
    return {
      ok: true,
      url,
      reachable: true,
      version: versionStr,
      error: null
    }
  } catch (err) {
    return {
      ok: false,
      url,
      reachable: false,
      version: null,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

// --- text normalization & similarity ---
// Exported for unit tests (and any future caller); pure string logic.

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const A = new Set(a)
  const B = new Set(b)
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  const union = A.size + B.size - inter
  return union === 0 ? 0 : inter / union
}

export function containment(query: string[], target: string[]): number {
  if (query.length === 0) return 0
  const T = new Set(target)
  let hit = 0
  for (const q of query) if (T.has(q)) hit++
  return hit / query.length
}

export function similarity(query: string, target: string): number {
  const qTok = tokens(query)
  const tTok = tokens(target)
  if (qTok.length === 0 || tTok.length === 0) return 0
  const j = jaccard(qTok, tTok)
  const c = containment(qTok, tTok)
  return Math.max(j, c)
}

// --- path parsing ---

const FILENAME_CLEANUP = [
  /^\s*\d{1,3}[.\s)-]+\s*/, // "01. ", "01 - "
  /^\s*[A-Z]\d{1,2}[.\s)-]+\s*/i, // "A1 - "
  /\s*\[[^\]]*\]\s*$/, // trailing "[320]"
  /\s*\(\s*\d{4}\s*\)\s*$/ // trailing "(1999)"
]

export function cleanStem(name: string): string {
  let s = name.replace(/\.[a-z0-9]{1,5}$/i, '')
  for (const re of FILENAME_CLEANUP) s = s.replace(re, '')
  return s.trim()
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : ''
}

export function splitPath(filename: string): string[] {
  return filename.split(/[\\/]/).filter(Boolean)
}

export function guessArtistAlbum(parts: string[]): { artist: string | null; album: string | null; folder: string } {
  const folder = parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? '')
  const parent = parts.length >= 3 ? parts[parts.length - 3] : null
  // Common layouts:
  //   Artist/Album/01 - track.flac  → parent=Artist, folder=Album
  //   Artist - Album (year)/01 - track.flac → folder has both
  //   Various Artists/Album/…
  let artist: string | null = null
  let album: string | null = null

  const dashSplit = folder.split(/\s+-\s+/)
  if (dashSplit.length >= 2) {
    artist = dashSplit[0].trim()
    album = dashSplit.slice(1).join(' - ').replace(/\s*\(\s*\d{4}\s*\)\s*$/, '').trim()
  } else {
    album = folder.replace(/\s*\(\s*\d{4}\s*\)\s*$/, '').trim() || null
    if (parent) artist = parent.trim()
  }
  return { artist, album, folder }
}

// --- scoring ---

interface QueryCtx {
  artist: string
  album: string
  artistTokens: string[]
  albumTokens: string[]
}

function matchScore(q: QueryCtx, parts: string[]): { score: number; artist: number; album: number } {
  const { artist: guessedArtist, album: guessedAlbum } = guessArtistAlbum(parts)
  const stem = cleanStem(parts[parts.length - 1] ?? '')

  // Consider the whole path too — lots of shares put artist/album tokens in the folder chain.
  const allPath = parts.join(' ')

  const artistTargets = [guessedArtist ?? '', allPath, stem].join(' ')
  const albumTargets = [guessedAlbum ?? '', allPath].join(' ')

  const artistScore = q.artistTokens.length ? similarity(q.artist, artistTargets) : 0
  const albumScore = q.albumTokens.length ? similarity(q.album, albumTargets) : 0

  // If album score is low because path had no album info, don't let it drag down.
  let albumWeight = 0.6
  let artistWeight = 0.4
  if (albumScore < 0.25) {
    albumWeight = 0
    artistWeight = 1.0
  }
  const score = artistScore * artistWeight + albumScore * albumWeight
  return { score, artist: artistScore, album: albumScore }
}

export function qualityScore(f: {
  extension: string
  bitRate: number | null
  hasFreeUploadSlot: boolean
  uploadSpeed: number
  queueLength: number
}): number {
  let s = EXT_WEIGHT[f.extension] ?? 0.3
  if (f.bitRate !== null) {
    if (f.bitRate >= 320) s += 0.2
    else if (f.bitRate >= 256) s += 0.1
    else if (f.bitRate < 128) s -= 0.3
  }
  if (f.hasFreeUploadSlot) s += 0.1
  if (f.uploadSpeed > 100_000) s += 0.05
  if (f.queueLength > 10) s -= 0.1
  return s
}

function formatSummary(files: SlskdFile[]): string {
  const exts = new Set(files.map((f) => f.extension))
  const extList = [...exts].sort().join('/')
  const bitrates = files.map((f) => f.bitRate).filter((b): b is number => b !== null)
  if (bitrates.length === 0) return `${files.length} · ${extList}`
  const avg = Math.round(bitrates.reduce((a, b) => a + b, 0) / bitrates.length)
  return `${files.length} · ${extList} · ${avg}kbps`
}

// --- slskd API types (just what we use) ---

interface SlskdSearchResponse {
  username: string
  hasFreeUploadSlot: boolean
  uploadSpeed: number
  queueLength: number
  files: Array<{
    filename: string
    size: number
    bitRate?: number | null
    length?: number | null
  }>
}

interface SlskdSearchState {
  id: string
  isComplete: boolean
  state: string
  responseCount: number
  fileCount: number
}

// --- public API ---

export async function startSearch(artist: string, album: string): Promise<{ id: string }> {
  const id = randomUUID()
  const searchText = [artist, album].filter(Boolean).join(' ').trim()
  if (!searchText) throw new Error('empty search query')
  await req('/api/v0/searches', {
    method: 'POST',
    body: JSON.stringify({
      id,
      searchText,
      filterResponses: true,
      minimumPeerUploadSpeed: 10
    })
  })
  return { id }
}

export async function pollResponses(searchId: string): Promise<SlskdSearchResponse[]> {
  return req<SlskdSearchResponse[]>(
    `/api/v0/searches/${encodeURIComponent(searchId)}/responses`
  )
}

export async function getSearchState(searchId: string): Promise<SlskdSearchState> {
  return req<SlskdSearchState>(`/api/v0/searches/${encodeURIComponent(searchId)}`)
}

export async function stopSearch(searchId: string): Promise<void> {
  try {
    await req(`/api/v0/searches/${encodeURIComponent(searchId)}`, { method: 'DELETE' })
  } catch {
    // best-effort cleanup
  }
}

function toFile(raw: SlskdSearchResponse['files'][number]): SlskdFile | null {
  const extension = extOf(raw.filename)
  if (!AUDIO_EXT.has(extension)) return null
  return {
    filename: raw.filename,
    size: raw.size,
    bitRate: raw.bitRate ?? null,
    length: raw.length ?? null,
    extension
  }
}

// Given an ordered list of expected MB titles and a set of filenames, return
// how many distinct expected titles are covered. Files are matched to expected
// titles by normalized substring/token overlap; greedy per-title.
function countMatchedTracks(
  expectedTitles: string[],
  files: SlskdFile[]
): number {
  if (expectedTitles.length === 0) return 0
  const stems = files.map((f) => {
    const base = f.filename.split(/[\\/]/).pop() ?? f.filename
    return normalizeTitle(cleanStem(base))
  })
  const used = new Array(stems.length).fill(false)
  let matched = 0
  for (const title of expectedTitles) {
    const nt = normalizeTitle(title)
    if (!nt) continue
    // Token-overlap matcher. Filter out single-char filler ("a", "i") to
    // keep noise from dominating short titles — but only when there's
    // more than one token. Titles like "#1" normalize to a single "1"
    // token and would otherwise be silently dropped (made Strawberry
    // Jam's "#1" track always uncountable, so every upload reported 8/9).
    const allTokens = nt.split(/\s+/).filter(Boolean)
    const titleTokens =
      allTokens.length > 1 ? allTokens.filter((t) => t.length > 1) : allTokens
    if (titleTokens.length === 0) continue
    let bestIdx = -1
    let bestScore = 0
    for (let i = 0; i < stems.length; i++) {
      if (used[i]) continue
      const stemAll = stems[i].split(/\s+/).filter(Boolean)
      const stemTokens =
        stemAll.length > 1 ? stemAll.filter((t) => t.length > 1) : stemAll
      if (stemTokens.length === 0) continue
      const set = new Set(stemTokens)
      const hit = titleTokens.filter((t) => set.has(t)).length
      const cov = hit / titleTokens.length
      if (cov > bestScore) {
        bestScore = cov
        bestIdx = i
      }
    }
    if (bestIdx >= 0 && bestScore >= 0.6) {
      used[bestIdx] = true
      matched += 1
    }
  }
  return matched
}

export function rankResponses(
  artist: string,
  album: string,
  responses: SlskdSearchResponse[],
  expectedTitles: string[] = []
): SlskdAlbumCandidate[] {
  const q: QueryCtx = {
    artist,
    album,
    artistTokens: tokens(artist),
    albumTokens: tokens(album)
  }

  interface Bucket {
    username: string
    hasFreeUploadSlot: boolean
    uploadSpeed: number
    queueLength: number
    folder: string
    guessedArtist: string | null
    guessedAlbum: string | null
    files: SlskdFile[]
    matchScores: number[]
    qualityScores: number[]
  }
  const buckets = new Map<string, Bucket>()

  for (const resp of responses) {
    for (const rawFile of resp.files) {
      const file = toFile(rawFile)
      if (!file) continue
      const parts = splitPath(file.filename)
      const { artist: ga, album: gb, folder } = guessArtistAlbum(parts)
      const { score, album: albumScore } = matchScore(q, parts)
      if (score < MIN_SCORE_THRESHOLD && albumScore < 0.5) continue

      const key = `${resp.username}|${folder}`
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = {
          username: resp.username,
          hasFreeUploadSlot: resp.hasFreeUploadSlot,
          uploadSpeed: resp.uploadSpeed,
          queueLength: resp.queueLength,
          folder,
          guessedArtist: ga,
          guessedAlbum: gb,
          files: [],
          matchScores: [],
          qualityScores: []
        }
        buckets.set(key, bucket)
      }
      bucket.files.push(file)
      bucket.matchScores.push(score)
      bucket.qualityScores.push(
        qualityScore({
          extension: file.extension,
          bitRate: file.bitRate,
          hasFreeUploadSlot: resp.hasFreeUploadSlot,
          uploadSpeed: resp.uploadSpeed,
          queueLength: resp.queueLength
        })
      )
    }
  }

  const candidates: SlskdAlbumCandidate[] = []
  for (const b of buckets.values()) {
    if (b.files.length === 0) continue
    const avg = (xs: number[]): number => xs.reduce((a, v) => a + v, 0) / xs.length
    const avgMatch = avg(b.matchScores)
    const avgQuality = avg(b.qualityScores)
    const sortedFiles = b.files.slice().sort((x, y) => x.filename.localeCompare(y.filename))
    const matchedTracks = countMatchedTracks(expectedTitles, sortedFiles)
    let score: number
    if (expectedTitles.length > 0) {
      // With MB data, completeness dominates. A candidate missing tracks gets
      // heavily penalized, even if the files it does have are high quality.
      const completeness = matchedTracks / expectedTitles.length
      score = 0.6 * completeness + 0.25 * avgQuality + 0.15 * avgMatch
    } else {
      // Without MB data, fall back to file-count heuristic (cap at 12).
      const countBonus = Math.min(1, b.files.length / 12)
      score = 0.45 * avgMatch + 0.35 * avgQuality + 0.2 * countBonus
    }
    candidates.push({
      username: b.username,
      hasFreeUploadSlot: b.hasFreeUploadSlot,
      uploadSpeed: b.uploadSpeed,
      queueLength: b.queueLength,
      folder: b.folder,
      guessedArtist: b.guessedArtist,
      guessedAlbum: b.guessedAlbum,
      files: sortedFiles,
      score,
      avgMatchScore: avgMatch,
      avgQualityScore: avgQuality,
      formatSummary: formatSummary(b.files),
      matchedTracks
    })
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates.slice(0, 50)
}

function compactKey(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

// Collapse candidates by normalized (artist, album) — many users sharing the
// same release produce separate candidates; the UI wants one album card with
// alternates behind a disclosure.
export function groupCandidatesByAlbum(
  candidates: SlskdAlbumCandidate[]
): SlskdAlbumGroup[] {
  const buckets = new Map<string, SlskdAlbumCandidate[]>()
  for (const c of candidates) {
    const albumPart = compactKey(c.guessedAlbum ?? c.folder)
    const artistPart = compactKey(c.guessedArtist ?? '')
    // Album alone is usually distinctive; include artist only when present to
    // avoid splitting groups when one candidate's parent folder was missing.
    const key = artistPart ? `${artistPart}::${albumPart}` : albumPart || c.folder
    const bucket = buckets.get(key)
    if (bucket) bucket.push(c)
    else buckets.set(key, [c])
  }
  const groups: SlskdAlbumGroup[] = []
  for (const [key, members] of buckets) {
    // Already sorted descending by score within the input; primary = first.
    const primary = members[0]
    groups.push({
      key,
      displayArtist: primary.guessedArtist ?? '',
      displayAlbum: primary.guessedAlbum ?? primary.folder,
      primary,
      alternates: members.slice(1)
    })
  }
  groups.sort((a, b) => b.primary.score - a.primary.score)
  return groups
}

async function mbReleaseHint(
  artist: string,
  album: string,
  preferredReleaseMbid?: string
): Promise<{ hint: SlskdReleaseHint; titles: string[] } | null> {
  try {
    // User-pinned release takes precedence — skip search entirely.
    if (preferredReleaseMbid) {
      const [cand, titles] = await Promise.all([
        getReleaseCandidate(preferredReleaseMbid),
        getReleaseTracks(preferredReleaseMbid)
      ])
      if (!cand || titles.length === 0) return null
      return {
        hint: {
          mbid: cand.mbid,
          title: cand.title,
          artistName: cand.artistName,
          date: cand.date,
          expectedTrackCount: titles.length
        },
        titles
      }
    }

    if (!album.trim()) return null
    const candidates = await searchReleaseCandidates(artist, album, 5)
    if (candidates.length === 0) return null
    // Prefer the top-scored result whose track count is plausible (>= 2).
    // The threshold rejects 1-track singles. We used to require >= 3 but that
    // also discarded legit 2-track EPs (e.g. Jeff Parker ETA IVtet's "Happy
    // Today"), forcing the resolver onto a longer, non-canonical edition.
    const picked = candidates.find((c) => (c.trackCount ?? 0) >= 2) ?? candidates[0]
    // Bias toward the original release: if the picked release is a deluxe /
    // anniversary / reissue edition, swap to the earliest-dated release in the
    // same release-group. Cratedigger is album-oriented, and user doesn't want
    // expected-track-count inflated by bonus tracks.
    let finalMbid = picked.mbid
    let finalTitle = picked.title
    let finalArtist = picked.artistName
    let finalDate = picked.date
    const earliest = await pickEarliestReleaseInGroup(picked.mbid).catch(() => null)
    if (earliest && earliest !== picked.mbid) {
      const cand = await getReleaseCandidate(earliest).catch(() => null)
      if (cand) {
        finalMbid = cand.mbid
        finalTitle = cand.title
        finalArtist = cand.artistName || picked.artistName
        finalDate = cand.date
      }
    }
    const titles = await getReleaseTracks(finalMbid)
    if (titles.length === 0) return null
    return {
      hint: {
        mbid: finalMbid,
        title: finalTitle,
        artistName: finalArtist,
        date: finalDate,
        expectedTrackCount: titles.length
      },
      titles
    }
  } catch {
    return null
  }
}

// Score same-release-group siblings of `currentMbid` against the actual files
// the user is about to download (the top slskd candidate). Returns a swap if
// any sibling beats the current matched count; otherwise null. Bounded by
// listSameCountSiblings (≤6 MB calls + one per sibling tracklist). See the
// helper in musicbrainz.ts for the Beleléu case that motivated this.
async function maybeSwapToSibling(
  currentMbid: string,
  currentTitles: string[],
  topCandidateFiles: SlskdFile[],
  currentMatched: number
): Promise<{ titles: string[]; hint: SlskdReleaseHint } | null> {
  try {
    const siblings = await listSameCountSiblings(currentMbid)
    if (siblings.length === 0) return null
    const sortedFiles = topCandidateFiles
      .slice()
      .sort((x, y) => x.filename.localeCompare(y.filename))
    let bestMatched = currentMatched
    let bestSibling: { titles: string[]; hint: SlskdReleaseHint } | null = null
    for (const s of siblings) {
      const titles = await getReleaseTracks(s.mbid).catch(() => [] as string[])
      if (titles.length === 0) continue
      const matched = countMatchedTracks(titles, sortedFiles)
      if (matched > bestMatched) {
        // Need the proper hint shape; fetch the candidate row for artist name.
        const cand = await getReleaseCandidate(s.mbid).catch(() => null)
        if (!cand) continue
        bestMatched = matched
        bestSibling = {
          titles,
          hint: {
            mbid: cand.mbid,
            title: cand.title,
            artistName: cand.artistName,
            date: cand.date,
            expectedTrackCount: titles.length
          }
        }
        // Found a perfect-match release; no need to keep checking.
        if (matched === titles.length) break
      }
    }
    return bestSibling
  } catch {
    return null
  }
}

// slskd rejects concurrent /api/v0/searches with 429 ("Only one concurrent
// operation is permitted"), so every searchAndWait must wait its turn. We also
// await stopSearch before releasing, so slskd has finished cleanup before the
// next POST — otherwise DELETE vs POST can still race.
let searchChain: Promise<unknown> = Promise.resolve()

export function searchAndWait(
  artist: string,
  album: string,
  options: { signal?: AbortSignal; preferredReleaseMbid?: string } = {}
): Promise<SlskdSearchResult> {
  const { signal, preferredReleaseMbid } = options
  const run = async (): Promise<SlskdSearchResult> => {
    const start = Date.now()
    // Kick off MB lookup in parallel with the slskd search; it only delays us
    // if slskd finishes first (rare — slskd is slow).
    const mbPromise = mbReleaseHint(artist, album, preferredReleaseMbid)
    const { id } = await startSearch(artist, album)
    try {
      let lastResponses: SlskdSearchResponse[] = []
      let complete = false
      while (Date.now() - start < SEARCH_TIMEOUT_MS) {
        if (signal?.aborted) break
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        const [state, responses] = await Promise.all([
          getSearchState(id).catch(() => null),
          pollResponses(id).catch(() => [] as SlskdSearchResponse[])
        ])
        lastResponses = responses
        if (state?.isComplete) {
          complete = true
          break
        }
      }
      // slskd only materialises the /responses payload when the search
      // completes, and it lags a beat behind the isComplete flag — so the
      // concurrent fetch on the tick we broke on usually still came back
      // empty, and we'd rank an empty set ("no results" for every search).
      // Now that the search is done, re-poll until the payload shows up
      // (bounded), so a real result set isn't dropped to the materialisation lag.
      if (complete && !signal?.aborted && lastResponses.length === 0) {
        for (let i = 0; i < 3; i++) {
          const fresh = await pollResponses(id).catch(() => [] as SlskdSearchResponse[])
          if (fresh.length > 0) {
            lastResponses = fresh
            break
          }
          if (signal?.aborted) break
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        }
      }
      const mb = await mbPromise
      let expectedTitles = mb?.titles ?? []
      let candidates = rankResponses(artist, album, lastResponses, expectedTitles)
      let release = mb?.hint ?? null
      // Sibling-release fallback: when the auto-picked release didn't fully
      // match the best slskd candidate, MB likely has another pressing in the
      // same release group whose tracklist actually corresponds to the files
      // the user is about to download. Try same-count siblings and swap if
      // one beats the current pick. Bounded by listSameCountSiblings (≤6).
      // Only runs when (a) we have an MB pick, (b) auto-picked (not user-pinned),
      // and (c) the top candidate is a partial match.
      if (
        mb &&
        !preferredReleaseMbid &&
        expectedTitles.length > 0 &&
        candidates.length > 0 &&
        candidates[0].matchedTracks < expectedTitles.length
      ) {
        const better = await maybeSwapToSibling(
          mb.hint.mbid,
          expectedTitles,
          candidates[0].files,
          candidates[0].matchedTracks
        )
        if (better) {
          expectedTitles = better.titles
          release = better.hint
          candidates = rankResponses(artist, album, lastResponses, expectedTitles)
        }
      }
      return {
        query: { artist, album },
        candidates,
        albums: groupCandidatesByAlbum(candidates),
        release,
        responseCount: lastResponses.length,
        complete,
        elapsedMs: Date.now() - start
      }
    } finally {
      await stopSearch(id)
    }
  }
  const next = searchChain.then(run, run)
  searchChain = next.catch(() => undefined)
  return next
}

export async function enqueueDownload(req_: SlskdEnqueueRequest): Promise<SlskdEnqueueResult> {
  const errors: { filename: string; error: string }[] = []
  let accepted = 0
  let alreadyInProgress = 0
  // slskd accepts one POST with a list; soulbeet batches in 3s to be gentle.
  const batchSize = 3
  for (let i = 0; i < req_.files.length; i += batchSize) {
    const batch = req_.files.slice(i, i + batchSize)
    try {
      await req(`/api/v0/transfers/downloads/${encodeURIComponent(req_.username)}`, {
        method: 'POST',
        body: JSON.stringify(batch.map((f) => ({ filename: f.filename, size: f.size })))
      })
      accepted += batch.length
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/already in progress/i.test(msg)) {
        alreadyInProgress += batch.length
      } else {
        for (const f of batch) errors.push({ filename: f.filename, error: msg })
      }
    }
    if (i + batchSize < req_.files.length) {
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  return { username: req_.username, accepted, alreadyInProgress, errors }
}

interface RawDownloadFile {
  id: string
  filename: string
  state?: string
  percentComplete?: number
  size?: number
  bytesTransferred?: number
  averageSpeed?: number
  startedAt?: string | null
  endedAt?: string | null
}
interface RawDownloadDir {
  directory: string
  files: RawDownloadFile[]
}
interface RawDownloadUser {
  username: string
  directories: RawDownloadDir[]
}

function classifyState(s: string): 'inProgress' | 'completed' | 'errored' | 'queued' | 'other' {
  const low = s.toLowerCase()
  if (low.includes('inprogress') || low.includes('initializing')) return 'inProgress'
  if (low.includes('succeeded')) return 'completed'
  if (
    low.includes('errored') ||
    low.includes('timedout') ||
    low.includes('cancelled') ||
    low.includes('rejected')
  ) {
    return 'errored'
  }
  if (low.includes('queued')) return 'queued'
  return 'other'
}

export async function removeDownload(
  username: string,
  id: string
): Promise<void> {
  await req(
    `/api/v0/transfers/downloads/${encodeURIComponent(username)}/${encodeURIComponent(id)}?remove=true`,
    { method: 'DELETE' }
  )
}

// Retry = drop the prior (likely errored) entry then re-POST the same file.
// slskd's own UI does the same dance; there's no dedicated retry endpoint.
export async function retryDownload(
  username: string,
  id: string,
  filename: string,
  size: number
): Promise<void> {
  // Best-effort remove; if the entry is already gone (e.g. user clicked twice)
  // slskd returns 404 and we ignore it.
  try {
    await removeDownload(username, id)
  } catch (err) {
    if (!/404/.test(err instanceof Error ? err.message : String(err))) throw err
  }
  // Small gap so slskd has time to finalize the delete before the new POST.
  await new Promise((r) => setTimeout(r, 250))
  await req(
    `/api/v0/transfers/downloads/${encodeURIComponent(username)}`,
    {
      method: 'POST',
      body: JSON.stringify([{ filename, size }])
    }
  )
}

export async function listDownloads(): Promise<SlskdDownloads> {
  const raw = await req<RawDownloadUser[]>('/api/v0/transfers/downloads')
  const users: SlskdDownloadUser[] = []
  const totals = { files: 0, inProgress: 0, completed: 0, errored: 0, queued: 0 }
  for (const u of raw) {
    let inProgress = 0
    let completed = 0
    let errored = 0
    let total = 0
    const directories = u.directories.map((d) => {
      const files: SlskdDownloadFile[] = d.files.map((f) => {
        total += 1
        totals.files += 1
        const state = f.state ?? 'Unknown'
        const cls = classifyState(state)
        if (cls === 'inProgress') {
          inProgress += 1
          totals.inProgress += 1
        } else if (cls === 'completed') {
          completed += 1
          totals.completed += 1
        } else if (cls === 'errored') {
          errored += 1
          totals.errored += 1
        } else if (cls === 'queued') {
          totals.queued += 1
        }
        return {
          id: f.id,
          filename: f.filename,
          state,
          percent: f.percentComplete ?? 0,
          size: f.size ?? 0,
          bytesTransferred: f.bytesTransferred ?? 0,
          averageSpeed: f.averageSpeed ?? 0,
          startedAt: f.startedAt ?? null,
          endedAt: f.endedAt ?? null
        }
      })
      return { directory: d.directory, files }
    })
    users.push({
      username: u.username,
      directories,
      totalFiles: total,
      inProgressFiles: inProgress,
      completedFiles: completed,
      erroredFiles: errored
    })
  }
  // Most-active users first: inProgress desc, then queued/errored, then completed-only last.
  users.sort((a, b) => {
    if (a.inProgressFiles !== b.inProgressFiles) return b.inProgressFiles - a.inProgressFiles
    if (a.erroredFiles !== b.erroredFiles) return b.erroredFiles - a.erroredFiles
    return b.totalFiles - a.totalFiles
  })
  return { users, totals }
}
