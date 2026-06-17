import type { BookletImage, CoverCandidate } from '../shared/plex.js'

interface CaaImage {
  id?: number | string
  image?: string
  thumbnails?: Record<string, string>
  types?: string[]
  approved?: boolean
  comment?: string
}

interface CaaResponse {
  images?: CaaImage[]
}

const USER_AGENT = 'cratedigger/0.4.0 (https://github.com/jaybeaman/cratedigger; contact via github)'

const BOOKLET_TYPES = new Set(['Booklet', 'Back', 'Tray', 'Medium', 'Liner', 'Obi', 'Other'])

const cache = new Map<string, BookletImage[]>()

export async function getBookletImages(releaseMbid: string): Promise<BookletImage[]> {
  const key = releaseMbid.toLowerCase()
  const cached = cache.get(key)
  if (cached) return cached

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(`https://coverartarchive.org/release/${encodeURIComponent(key)}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctrl.signal
    })
    if (res.status === 404) {
      cache.set(key, [])
      return []
    }
    if (!res.ok) return []
    const json = (await res.json()) as CaaResponse
    const out: BookletImage[] = []
    for (const img of json.images ?? []) {
      if (img.approved === false) continue
      const types = (img.types ?? []).filter((t) => typeof t === 'string')
      if (types.length === 0) continue
      // Drop pure-front entries; we already display the front cover prominently.
      if (types.length === 1 && types[0] === 'Front') continue
      if (!types.some((t) => BOOKLET_TYPES.has(t))) continue
      const full = img.image
      if (!full) continue
      const thumb = img.thumbnails?.['500'] ?? img.thumbnails?.large ?? img.thumbnails?.['250'] ?? full
      out.push({
        id: String(img.id ?? full),
        url: full,
        thumbUrl: thumb,
        types,
        comment: (img.comment ?? '').trim()
      })
    }
    cache.set(key, out)
    return out
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

const frontCache = new Map<string, CoverCandidate[]>()

// Front-cover variants for a single MB release. Cover Art Archive often has
// multiple approved fronts (different printings, regional sleeves) — surface
// them all so the user can pick which one Cratedigger displays.
export async function getReleaseFrontCovers(releaseMbid: string): Promise<CoverCandidate[]> {
  const key = releaseMbid.toLowerCase()
  const cached = frontCache.get(key)
  if (cached) return cached

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(`https://coverartarchive.org/release/${encodeURIComponent(key)}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctrl.signal
    })
    if (res.status === 404) {
      frontCache.set(key, [])
      return []
    }
    if (!res.ok) return []
    const json = (await res.json()) as CaaResponse
    const out: CoverCandidate[] = []
    for (const img of json.images ?? []) {
      if (img.approved === false) continue
      const types = (img.types ?? []).filter((t) => typeof t === 'string')
      if (!types.includes('Front')) continue
      const full = img.thumbnails?.['1200'] ?? img.thumbnails?.large ?? img.image
      const thumb =
        img.thumbnails?.['500'] ??
        img.thumbnails?.['250'] ??
        img.thumbnails?.small ??
        full ??
        img.image
      if (!full || !thumb) continue
      out.push({
        source: 'caa',
        url: full,
        thumbUrl: thumb,
        label: (img.comment ?? '').trim() || null
      })
    }
    frontCache.set(key, out)
    return out
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}
