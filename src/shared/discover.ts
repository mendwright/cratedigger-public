// Discover shelf + artist news, served by the tagger (service/app/discover.py,
// service/app/news.py). Ideas borrowed from Aurral.

export type DiscoverDepth = 'close' | 'deeper'

export interface DiscoverPick {
  artist: string
  mbid: string | null
  score: number
  /** Your artists that point at this one, strongest first ("like X, Y"). */
  like: string[]
  /** Deeper only: the close pick this one came through ("via X"). */
  via: string | null
  seedCount: number
  image?: string | null
}

export interface DiscoverList {
  builtAt: number | null
  /** The tagger is building (first run, or the list is over a week old). */
  building: boolean
  depth: DiscoverDepth
  picks: DiscoverPick[]
}

export interface NewsStory {
  id: string
  source: string
  title: string
  url: string
  date: number | null
  firstSeen?: number | null
  image: string | null
  summary: string
  tags: string[]
  /** Library artists the story names (empty = not highlighted). */
  artists: string[]
}

export interface NewsFeed {
  updatedAt: number | null
  stories: NewsStory[]
}

/** "like Pharoah Sanders, Alice Coltrane" / "via Grouper". */
export function pickReason(p: Pick<DiscoverPick, 'like' | 'via'>): string {
  if (p.like.length > 0) return `like ${p.like.slice(0, 2).join(', ')}`
  if (p.via) return `via ${p.via}`
  return ''
}

/** Highlighted stories newer than `seenAt` — drives the dot on the toolbar pill. */
export function unseenHighlighted(stories: NewsStory[], seenAt: number): number {
  return stories.filter((s) => s.artists.length > 0 && (s.firstSeen ?? s.date ?? 0) > seenAt).length
}
