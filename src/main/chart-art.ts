import type { ChartDimension, ChartEntry } from '../shared/charts.js'
import { librarySnapshot } from './library-snapshot.js'
import { getArtistBio } from './bios.js'
import { searchArtistByName } from './musicbrainz.js'
import { JsonCache } from './mb-cache.js'
import { buildHistoryIndex, matchHistoryArtist, matchHistoryAlbum } from '../shared/history-match.js'

const photos = new JsonCache<string[]>('chart-photos-v2')
const pending = new Map<string, Promise<string[]>>()
// A small queue avoids flooding bio services; MusicBrainz itself uses paced().
let tail: Promise<unknown> = Promise.resolve()

export function chartArt(entry: ChartEntry, dimension: ChartDimension): Promise<string[]> {
  const key = `${dimension}|${entry.title}|${entry.subtitle ?? ''}`
  // Album/track fallbacks are local data and CAA URLs: never queue them behind bios.
  if (dimension !== 'artists') return resolve(entry, dimension, key)
  const hit = pending.get(key)
  if (hit) return hit
  const job = (async () => {
    const cached = dimension === 'artists' ? await photos.get(key) : undefined
    if (cached !== undefined) return resolve(entry, dimension, key)
    const queued = tail.then(() => resolve(entry, dimension, key))
    tail = queued.catch(() => {})
    return queued
  })()
  pending.set(key, job)
  void job.finally(() => pending.delete(key)).catch(() => {})
  return job
}

async function resolve(e: ChartEntry, dimension: ChartDimension, key: string): Promise<string[]> {
  const albums = await librarySnapshot.allAlbums()
  if (dimension === 'artists') {
    const index = buildHistoryIndex(albums)
    const artistKey = e.ratingKey ?? matchHistoryArtist(index, e.title)
    const covers = albums.filter(a => artistKey ? a.artistRatingKey === artistKey : a.artist.toLocaleLowerCase() === e.title.toLocaleLowerCase())
      .sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
    let urls = await photos.get(key)
    if (urls === undefined) {
      const results = await Promise.allSettled([
        (async () => {
          const mbid = await searchArtistByName(e.title)
          const bio = mbid ? await getArtistBio({ mbid, name: e.title }) : null
          return bio?.image?.source === 'wikipedia' ? bio.image.url : null
        })(),
        deezerPhoto(e.title)
      ])
      urls = results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
      // Cache successful misses too, but retry transient service failures next time.
      if (results.every(result => result.status === 'fulfilled')) await photos.set(key, urls)
    }
    return [...(urls ?? []), ...covers.map(a => a.thumb).filter((p): p is string => !!p).slice(0, 3)]
  }
  const title = dimension === 'albums' ? e.title : e.album
  const matched = e.subtitle && title ? matchHistoryAlbum(buildHistoryIndex(albums), e.subtitle, title) : null
  const keyed = albums.find(a => a.ratingKey === e.ratingKey)
  // A stale history thumb/key must not prevent a current name match supplying art.
  const candidates = [...new Set([keyed, matched].filter(a => a != null))]
  const urls: string[] = []
  for (const album of candidates) {
    if (album.thumb && album.thumb !== e.thumb) urls.push(album.thumb)
  }
  for (const album of candidates) {
    for (const guid of album.guids) {
      const match = /^mbid:\/\/(?:(release|release-group)\/)?([a-f0-9-]{36})$/i.exec(guid)
      if (match) urls.push(`https://coverartarchive.org/${match[1] ?? 'release'}/${match[2]}/front-500`)
    }
  }
  return [...new Set(urls)]
}

function artistName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

async function deezerPhoto(name: string): Promise<string | null> {
  const url = new URL('https://api.deezer.com/search/artist')
  url.searchParams.set('q', name)
  url.searchParams.set('limit', '5')
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error(`Deezer artist search: HTTP ${response.status}`)
  const doc = await response.json() as { data?: { name?: string; picture_xl?: string }[]; error?: unknown }
  if (doc.error) throw new Error('Deezer artist search failed')
  for (const candidate of doc.data ?? []) {
    // Similar names and tribute acts are different artists. Never substitute one.
    if (!candidate.name || artistName(candidate.name) !== artistName(name) || !candidate.picture_xl) continue
    try {
      const picture = new URL(candidate.picture_xl)
      if (picture.protocol !== 'https:' || picture.pathname.includes('/images/artist//')) continue
      return picture.href
    } catch { /* malformed image URL: try the next exact-name match */ }
  }
  return null
}
