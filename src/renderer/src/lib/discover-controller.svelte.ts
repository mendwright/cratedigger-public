import type { DiscoverDepth, DiscoverPick, NewsStory } from '../../../shared/discover'
import { unseenHighlighted } from '../../../shared/discover'

// Discover shelf + artist news (tagger-backed, see src/main/discover.ts).
// One small controller rather than more PlexState fields.

const DEPTH_KEY = 'cd.discover.depth'
const NEWS_SEEN_KEY = 'cd.news.seenAt'
const NEWS_POLL_MS = 30 * 60_000

function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private storage unavailable — the preference just doesn't stick
  }
}

export class DiscoverController {
  depth = $state<DiscoverDepth>(load(DEPTH_KEY) === 'deeper' ? 'deeper' : 'close')
  picks = $state<DiscoverPick[]>([])
  builtAt = $state<number | null>(null)
  building = $state(false)
  loading = $state(false)
  /** null = never loaded; false = no tagger / no history for this account. */
  available = $state<boolean | null>(null)
  error = $state<string | null>(null)

  news = $state<NewsStory[]>([])
  newsLoading = $state(false)
  newsAvailable = $state<boolean | null>(null)
  newsHighlightedOnly = $state(true)
  // First run on this Mac: the stories already there aren't news to you.
  newsSeenAt = $state<number>(Number(load(NEWS_SEEN_KEY)) || this.firstSeen())
  unseenNews = $derived(unseenHighlighted(this.news, this.newsSeenAt))

  private firstSeen(): number {
    const now = Date.now()
    save(NEWS_SEEN_KEY, String(now))
    return now
  }

  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private newsTimer: ReturnType<typeof setInterval> | null = null

  async activate(): Promise<void> {
    await this.load()
  }

  async load(): Promise<void> {
    this.loading = this.picks.length === 0
    this.error = null
    try {
      const doc = await window.cratedigger.discover.list(this.depth)
      this.available = !!doc
      this.picks = doc?.picks ?? []
      this.builtAt = doc?.builtAt ?? null
      this.building = !!doc?.building
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
    } finally {
      this.loading = false
    }
    // The first build takes a few minutes on the tagger; check back.
    if (this.pollTimer) clearTimeout(this.pollTimer)
    if (this.building) this.pollTimer = setTimeout(() => void this.load(), 20_000)
  }

  setDepth(depth: DiscoverDepth): void {
    if (depth === this.depth) return
    this.depth = depth
    save(DEPTH_KEY, depth)
    this.picks = []
    void this.load()
  }

  async hide(pick: DiscoverPick): Promise<void> {
    this.picks = this.picks.filter((p) => p.artist !== pick.artist)
    try {
      await window.cratedigger.discover.hide({ artist: pick.artist, hide: true })
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
    }
  }

  async rebuild(): Promise<void> {
    await window.cratedigger.discover.rebuild()
    this.building = true
    void this.load()
  }

  // --- news ---

  /** Background poll so the toolbar dot can light without opening the tab. */
  startNewsPolling(): void {
    if (this.newsTimer) return
    void this.loadNews()
    this.newsTimer = setInterval(() => void this.loadNews(), NEWS_POLL_MS)
  }

  async loadNews(): Promise<void> {
    this.newsLoading = this.news.length === 0
    try {
      const doc = await window.cratedigger.news.feed()
      this.newsAvailable = !!doc
      this.news = doc?.stories ?? []
    } catch {
      // keep what we had; the tab shows the last good list
    } finally {
      this.newsLoading = false
    }
  }

  /** Opening the news tab clears the dot. */
  markNewsSeen(): void {
    const now = Date.now()
    this.newsSeenAt = now
    save(NEWS_SEEN_KEY, String(now))
  }
}
