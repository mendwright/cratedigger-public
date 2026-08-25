import type {
  AlbumFilters,
  PlaystateFilter
} from '../../../shared/plex'

// One deep module owning every library filter dimension — genres, labels,
// year/decade, mood, playstate. Replaces eight loose fields and ~15 per-
// dimension mutator methods that used to live on plex-state.
//
// plex-state holds one instance and exposes thin wrappers that delegate
// here, then trigger the side effects (re-select-section, fetch full
// library when a client-only filter goes active). Method names here
// avoid the side-effect verbs ("toggleGenre" mutates state only — the
// orchestrator decides what to do next).

export type { PlaystateFilter }

export class FilterState {
  // Server-side filters (the Plex section's /all endpoint honors them).
  genreInclude = $state<Set<string>>(new Set())
  genreExclude = $state<Set<string>>(new Set())
  selectedDecade = $state<number | null>(null)
  selectedYear = $state<number | null>(null)
  selectedMood = $state<{ id: string; title: string } | null>(null)

  // Client-side filters (applied after the renderer has the full library).
  labelInclude = $state<Set<string>>(new Set())
  labelExclude = $state<Set<string>>(new Set())
  selectedPlaystate = $state<PlaystateFilter>('all')

  // ---- Genre ----

  // 3-way cycle: neutral → include → exclude → neutral.
  toggleGenre(genre: string): void {
    const include = new Set(this.genreInclude)
    const exclude = new Set(this.genreExclude)
    if (include.has(genre)) {
      include.delete(genre)
      exclude.add(genre)
    } else if (exclude.has(genre)) {
      exclude.delete(genre)
    } else {
      include.add(genre)
    }
    this.genreInclude = include
    this.genreExclude = exclude
  }

  // Chip-body click — flip include↔exclude. No-op on a value that's
  // neither (deliberate; distinct from toggleGenre's 3-way cycle).
  flipGenre(genre: string): void {
    const include = new Set(this.genreInclude)
    const exclude = new Set(this.genreExclude)
    if (include.has(genre)) {
      include.delete(genre)
      exclude.add(genre)
    } else if (exclude.has(genre)) {
      exclude.delete(genre)
      include.add(genre)
    } else {
      return
    }
    this.genreInclude = include
    this.genreExclude = exclude
  }

  // Chip × — drop from either set. Always returns to neutral.
  removeGenre(genre: string): void {
    const include = new Set(this.genreInclude)
    const exclude = new Set(this.genreExclude)
    let changed = false
    if (include.delete(genre)) changed = true
    if (exclude.delete(genre)) changed = true
    if (!changed) return
    this.genreInclude = include
    this.genreExclude = exclude
  }

  clearGenres(): boolean {
    if (this.genreInclude.size === 0 && this.genreExclude.size === 0) return false
    this.genreInclude = new Set()
    this.genreExclude = new Set()
    return true
  }

  // The crate rail picks exactly one genre at a time, which is a different
  // gesture from the chip panel's 3-way cycle: it replaces whatever genre
  // selection was there rather than adding to it. Passing null clears.
  // Returns false when nothing changed, so the caller can skip the re-fetch.
  setGenreCrate(genre: string | null): boolean {
    if (genre === null) {
      if (this.genreInclude.size === 0 && this.genreExclude.size === 0) return false
      this.genreInclude = new Set()
      this.genreExclude = new Set()
      return true
    }
    if (this.genreInclude.size === 1 && this.genreInclude.has(genre) && this.genreExclude.size === 0) {
      return false
    }
    this.genreInclude = new Set([genre])
    this.genreExclude = new Set()
    return true
  }

  // Which crate the rail should draw as selected: only when the genre
  // selection is exactly one included genre. Add a second genre through the
  // chip panel and the rail honestly shows nothing selected.
  crateGenre(): string | null {
    if (this.genreExclude.size > 0 || this.genreInclude.size !== 1) return null
    return [...this.genreInclude][0]
  }

  genreStateOf(value: string): 'neutral' | 'include' | 'exclude' {
    if (this.genreInclude.has(value)) return 'include'
    if (this.genreExclude.has(value)) return 'exclude'
    return 'neutral'
  }

  // ---- Label ----

  toggleLabel(label: string): void {
    const include = new Set(this.labelInclude)
    const exclude = new Set(this.labelExclude)
    if (include.has(label)) {
      include.delete(label)
      exclude.add(label)
    } else if (exclude.has(label)) {
      exclude.delete(label)
    } else {
      include.add(label)
    }
    this.labelInclude = include
    this.labelExclude = exclude
  }

  flipLabel(label: string): void {
    const include = new Set(this.labelInclude)
    const exclude = new Set(this.labelExclude)
    if (include.has(label)) {
      include.delete(label)
      exclude.add(label)
    } else if (exclude.has(label)) {
      exclude.delete(label)
      include.add(label)
    } else {
      return
    }
    this.labelInclude = include
    this.labelExclude = exclude
  }

  removeLabel(label: string): void {
    const include = new Set(this.labelInclude)
    const exclude = new Set(this.labelExclude)
    let changed = false
    if (include.delete(label)) changed = true
    if (exclude.delete(label)) changed = true
    if (!changed) return
    this.labelInclude = include
    this.labelExclude = exclude
  }

  clearLabels(): boolean {
    if (this.labelInclude.size === 0 && this.labelExclude.size === 0) return false
    this.labelInclude = new Set()
    this.labelExclude = new Set()
    return true
  }

  // Replace label include set with exactly this one value (e.g. from a
  // FilterByLabel chip click). Exclude is cleared.
  setLabelInclude(label: string): void {
    this.labelInclude = new Set([label])
    this.labelExclude = new Set()
  }

  // Rewrite an active label filter from `from` to `to` — used after the user
  // merges a label alias so an existing "include New West Records LLC" doesn't
  // strand itself once the LLC row vanishes from the filter UI. Returns true
  // if anything changed (caller may want to refilter).
  migrateLabel(from: string, to: string): boolean {
    let changed = false
    if (this.labelInclude.has(from)) {
      const next = new Set(this.labelInclude)
      next.delete(from)
      next.add(to)
      this.labelInclude = next
      changed = true
    }
    if (this.labelExclude.has(from)) {
      const next = new Set(this.labelExclude)
      next.delete(from)
      next.add(to)
      this.labelExclude = next
      changed = true
    }
    return changed
  }

  labelStateOf(value: string): 'neutral' | 'include' | 'exclude' {
    if (this.labelInclude.has(value)) return 'include'
    if (this.labelExclude.has(value)) return 'exclude'
    return 'neutral'
  }

  // ---- Year / Decade (mutually exclusive) ----

  setDecade(decade: number | null): boolean {
    if (this.selectedDecade === decade && this.selectedYear == null) return false
    this.selectedDecade = decade
    this.selectedYear = null
    return true
  }

  setYear(year: number | null): boolean {
    if (this.selectedYear === year && this.selectedDecade == null) return false
    this.selectedYear = year
    this.selectedDecade = null
    return true
  }

  // ---- Mood ----

  // Toggle behavior — clicking the active mood again clears it.
  setMood(mood: { id: string; title: string } | null): void {
    if (this.selectedMood && mood && this.selectedMood.id === mood.id) {
      this.selectedMood = null
    } else {
      this.selectedMood = mood
    }
  }

  clearMood(): boolean {
    if (this.selectedMood === null) return false
    this.selectedMood = null
    return true
  }

  // ---- Playstate ----

  setPlaystate(state: PlaystateFilter): boolean {
    if (this.selectedPlaystate === state) return false
    this.selectedPlaystate = state
    return true
  }

  // ---- Cross-cutting ----

  isEmpty(): boolean {
    return (
      this.genreInclude.size === 0 &&
      this.genreExclude.size === 0 &&
      this.labelInclude.size === 0 &&
      this.labelExclude.size === 0 &&
      this.selectedDecade === null &&
      this.selectedYear === null &&
      this.selectedMood === null &&
      this.selectedPlaystate === 'all'
    )
  }

  // Whether any active filter requires the full album cache (client-side
  // filtering on top of what the server returns). Year/decade are here because
  // Cratedigger files albums under their *original* release year (overlaid onto
  // the full library), not Plex's edition year — so a "1984" filter must run
  // client-side against the overlaid list, where a 2005 reissue reads as 1984.
  needsAllAlbums(): boolean {
    return (
      this.genreExclude.size > 0 ||
      this.labelInclude.size > 0 ||
      this.labelExclude.size > 0 ||
      this.selectedPlaystate !== 'all' ||
      this.selectedDecade != null ||
      this.selectedYear != null
    )
  }

  clearAll(): boolean {
    let changed = false
    if (this.genreInclude.size > 0 || this.genreExclude.size > 0) {
      this.genreInclude = new Set()
      this.genreExclude = new Set()
      changed = true
    }
    if (this.selectedDecade != null) {
      this.selectedDecade = null
      changed = true
    }
    if (this.selectedYear != null) {
      this.selectedYear = null
      changed = true
    }
    if (this.labelInclude.size > 0 || this.labelExclude.size > 0) {
      this.labelInclude = new Set()
      this.labelExclude = new Set()
      changed = true
    }
    if (this.selectedPlaystate !== 'all') {
      this.selectedPlaystate = 'all'
      changed = true
    }
    if (this.selectedMood !== null) {
      this.selectedMood = null
      changed = true
    }
    return changed
  }

  // Shape the Plex /all endpoint consumes. Excludes / labels / playstate
  // aren't here because the server doesn't honor them — they're applied
  // client-side off the full library.
  // `serverKnowsGenres` is false once the MusicBrainz genre index has data:
  // those genre names don't exist on the Plex server, so asking it to filter
  // by one returns an empty grid. The caller filters client-side instead.
  toAlbumFilters(serverKnowsGenres = true): AlbumFilters {
    const filters: AlbumFilters = {}
    if (serverKnowsGenres && this.genreInclude.size > 0) filters.genres = [...this.genreInclude]
    if (this.selectedYear != null) filters.year = this.selectedYear
    else if (this.selectedDecade != null) filters.decade = this.selectedDecade
    if (this.selectedMood) filters.mood = this.selectedMood.id
    return filters
  }

}
