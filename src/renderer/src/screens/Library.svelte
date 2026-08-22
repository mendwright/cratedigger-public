<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { plexState, splitAlbumMbids, COVER_SIZE_MIN, COVER_SIZE_MAX, type ContextMenuEntry } from '../lib/plex-state.svelte'
  import { queueMenuItems } from '../lib/queue-menu'
  import AlbumCard from '../lib/AlbumCard.svelte'
  import AlbumOfTheDay from '../lib/AlbumOfTheDay.svelte'
  import RecentAlbumsRail from '../lib/RecentAlbumsRail.svelte'
  import MoodStations from '../lib/MoodStations.svelte'
  import YearScrubRail from '../lib/YearScrubRail.svelte'
  import EditorialRail from '../lib/EditorialRail.svelte'
  import FocusBar from '../lib/FocusBar.svelte'
  import CrateRail from '../lib/CrateRail.svelte'
  import ShuffleSlotMachine from '../lib/ShuffleSlotMachine.svelte'
  import ScreenHeader from '../lib/ScreenHeader.svelte'
  import { albumMatchesFilters, playstateCutoffFor } from '../lib/album-filter'

  let slotMachine = $state<ShuffleSlotMachine | null>(null)

  function onDicePointerDown(e: PointerEvent): void {
    e.preventDefault()
    void slotMachine?.start()
  }

  // The dig strip: one row of chips, at most one shelf open at a time.
  //
  // Five separate discovery systems used to stack above the grid — four shelf
  // pills, mood stations, album of the day and the year scrubber — so the
  // albums themselves started below the fold. They're all still here, just
  // behind one strip that opens one at a time.
  //
  // The four rails stay mounted while collapsed because that's how they
  // compute their counts; only their row of covers is hidden. The three
  // panels below (moods / years / album of the day) carry no count, so they
  // mount only when open.
  type ShelfId = 'recent' | 'neglected' | 'fivestar' | 'neverspun' | 'moods' | 'years' | 'aotd'

  const SHELF_KEY = 'cratedigger:shelf-open'
  // Superseded by SHELF_KEY. Read once to carry a preference over, then
  // cleared — first one that was open wins, since only one can be now.
  const LEGACY_SHELF_KEYS: [ShelfId, string][] = [
    ['recent', 'cratedigger:shelf-open:recent'],
    ['neglected', 'cratedigger:shelf-open:neglected'],
    ['fivestar', 'cratedigger:shelf-open:fivestar'],
    ['neverspun', 'cratedigger:shelf-open:neverspun']
  ]

  function readActiveShelf(): ShelfId | null {
    if (typeof window === 'undefined') return null
    try {
      const stored = localStorage.getItem(SHELF_KEY)
      if (stored) return stored === 'none' ? null : (stored as ShelfId)
      let migrated: ShelfId | null = null
      for (const [id, key] of LEGACY_SHELF_KEYS) {
        if (localStorage.getItem(key) === '1' && migrated === null) migrated = id
        localStorage.removeItem(key)
      }
      localStorage.setItem(SHELF_KEY, migrated ?? 'none')
      return migrated
    } catch {
      return null
    }
  }

  // Bound from ScreenHeader — the crate rail sticks directly below the bar,
  // whose height moves with the sub line and the window width.
  let headerHeight = $state(0)
  let activeShelf = $state<ShelfId | null>(readActiveShelf())
  let countRecent = $state(0)
  let countNeglected = $state(0)
  let countFiveStar = $state(0)
  let countNeverSpun = $state(0)

  function toggleShelf(id: ShelfId): void {
    activeShelf = activeShelf === id ? null : id
    try {
      localStorage.setItem(SHELF_KEY, activeShelf ?? 'none')
    } catch {
      // storage quota or private mode; the choice stays in-memory only
    }
  }

  // `count: null` means the chip carries no number (nothing to count) — as
  // opposed to 0, which disables the chip because the shelf would be empty.
  const digChips = $derived<{ id: ShelfId; label: string; count: number | null }[]>([
    { id: 'recent', label: 'recently played', count: countRecent },
    { id: 'neglected', label: 'neglected gems', count: countNeglected },
    { id: 'fivestar', label: 'five-star vault', count: countFiveStar },
    { id: 'neverspun', label: 'never spun', count: countNeverSpun },
    { id: 'moods', label: 'moods', count: null },
    { id: 'years', label: 'by year', count: null }
  ])

  const session = $derived(plexState.session)
  const ctx = $derived(plexState.serverContext)
  const sections = $derived(plexState.sections)
  const activeSection = $derived(plexState.activeSectionKey)
  const paginatedAlbums = $derived(plexState.albums)
  const total = $derived(plexState.albumsTotal)
  const loading = $derived(plexState.libraryLoading)
  const loadingMore = $derived(plexState.albumsLoadingMore)
  const error = $derived(plexState.libraryError)
  const coverSize = $derived(plexState.coverSize)
  const sortKey = $derived(plexState.sortKey)
  const searchQuery = $derived(plexState.search.query)
  const searchResults = $derived(plexState.search.results)
  const searchLoading = $derived(plexState.search.loading)
  const searchError = $derived(plexState.search.error)
  const searchActive = $derived(searchQuery.trim().length > 0)

  const labelMap = $derived(plexState.labelIndex.labels)
  // MB genre index. Once it holds anything, genre filtering can no longer be
  // pushed to the Plex server (those genre names don't exist there), so it
  // joins the client-side filters below.
  const genreIndexActive = $derived(plexState.genreIndex.active)
  const fs = $derived(plexState.filterState)
  const genreInclude = $derived(fs.genreInclude)
  const genreExclude = $derived(fs.genreExclude)
  const labelInclude = $derived(fs.labelInclude)
  const labelExclude = $derived(fs.labelExclude)
  const selectedDecade = $derived(fs.selectedDecade)
  const selectedYear = $derived(fs.selectedYear)
  const selectedMood = $derived(fs.selectedMood)
  const selectedPlaystate = $derived(fs.selectedPlaystate)
  const playstateFilterActive = $derived(selectedPlaystate !== 'all')
  // Server can apply genre includes + mood via the Plex API. Genre excludes,
  // label filters, playstate, and year/decade need the full library (we drop
  // matches client-side). Year/decade are client-side because Cratedigger files
  // albums under their *original* release year — overlaid onto the full library
  // — not Plex's edition year, so a "1984" filter must run against the overlaid
  // list where a 2005 reissue reads as 1984.
  const serverFilterActive = $derived(
    genreInclude.size > 0 || selectedMood != null
  )
  const clientFilterActive = $derived(
    (genreInclude.size > 0 && genreIndexActive) ||
      genreExclude.size > 0 ||
      labelInclude.size > 0 ||
      labelExclude.size > 0 ||
      playstateFilterActive ||
      selectedDecade != null ||
      selectedYear != null
  )
  // Negligence is computed locally off allAlbums — same shape of "force the
  // client-side path" as the existing label/playstate filters.
  const clientSortActive = $derived(plexState.sortKey === 'negligence')
  const anyFilterActive = $derived(clientFilterActive || serverFilterActive)
  const allAlbums = $derived(plexState.allAlbums)
  const allAlbumsLoading = $derived(plexState.allAlbumsLoading)

  const albums = $derived.by(() => {
    // No client-side filter or sort → server already applied any genre/decade filter.
    if (!clientFilterActive && !clientSortActive) return paginatedAlbums
    // Anything client-side → use full library and re-apply server filters too.
    const source = allAlbums ?? paginatedAlbums
    const filters = {
      genreInclude,
      genreExclude,
      decade: selectedDecade,
      year: selectedYear,
      labelInclude,
      labelExclude,
      playstate: selectedPlaystate,
      playstateCutoffSec: playstateCutoffFor(selectedPlaystate)
    }
    const canonical = (name: string): string => plexState.labelAliases.canonical(name)
    const filtered = source.filter((a) =>
      albumMatchesFilters(
        a,
        filters,
        labelMap[a.ratingKey] ?? [],
        canonical,
        plexState.genreIndex.genresFor(a)
      )
    )
    if (!clientSortActive) return filtered
    // Negligence: rating × time-since-last-played, descending. Unrated albums
    // never bubble up (-1 score sinks them). Never-played albums are scored
    // off addedAt with a 5-year cap so a 20-year-old never-played album
    // doesn't permanently lock the top of the list.
    const nowSec = Date.now() / 1000
    return [...filtered].sort((a, b) => negligenceScore(b, nowSec) - negligenceScore(a, nowSec))
  })

  function negligenceScore(album: { rating: number | null; lastViewedAt: number | null; addedAt: number }, nowSec: number): number {
    const rating = album.rating ?? 0
    if (rating <= 0) return -1
    if (album.lastViewedAt) {
      const days = Math.max(0, (nowSec - album.lastViewedAt) / 86400)
      return rating * days
    }
    const days = Math.max(0, (nowSec - album.addedAt) / 86400)
    return rating * Math.min(days, 1825)
  }

  const canLoadMore = $derived(
    !clientFilterActive && !clientSortActive && paginatedAlbums.length < total && !loadingMore
  )

  // Bucket the thumb-fetch size to a small set of widths so dragging the
  // cover-size slider through 110–360 doesn't generate ~25 distinct transcode
  // URLs per card. Each unique URL is a fresh Plex transcode; piling dozens of
  // them on the server (especially toward 640px) backs up the transcoder past
  // the proxy's timeout and renders cards as broken images. CSS scales the
  // image smoothly within a bucket; we only re-fetch when crossing a boundary.
  const thumbRequestSize = $derived.by(() => {
    const target = coverSize * 2
    if (target <= 280) return 240
    if (target <= 400) return 320
    if (target <= 560) return 480
    return 640
  })

  const SORT_OPTIONS = [
    { value: 'addedAt', label: 'date added' },
    { value: 'artist', label: 'artist' },
    { value: 'title', label: 'album' },
    { value: 'lastViewed', label: 'recently played' },
    { value: 'rating', label: 'rating' },
    { value: 'negligence', label: 'neglected favorites' },
    { value: 'random', label: 'random' }
  ] as const

  // "4,318 albums · sorted by date added" — the header's sub line. Counts come
  // from the server total, not the loaded page, so it doesn't tick up as you
  // scroll.
  const sortLabel = $derived(SORT_OPTIONS.find((o) => o.value === sortKey)?.label ?? '')
  const headerSub = $derived(
    total > 0 ? `${total.toLocaleString()} albums · sorted by ${sortLabel}` : ''
  )

  let searchEl = $state<HTMLInputElement | null>(null)

  function onGlobalKey(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault()
      searchEl?.focus()
      searchEl?.select()
      return
    }
    if (e.key === 'Escape' && searchActive && document.activeElement === searchEl) {
      plexState.search.clear()
    }
  }

  function albumCtxItems(a: { ratingKey: string; title: string; artist: string; thumb?: string | null; year?: number | null; guids?: string[] }): ContextMenuEntry[] {
    const hasOverride = !!plexState.coverArt.overrides[a.ratingKey]
    const mbReleaseMbid = a.guids ? splitAlbumMbids(a.guids).release ?? null : null
    const savedForLater = plexState.isInListenLater(a.ratingKey)
    return [
      { label: 'Play Now', onClick: () => void plexState.playback.requestCastAlbum(a.ratingKey, a.title, a.artist) },
      ...queueMenuItems('album', a.ratingKey, a.title, a.artist),
      { separator: true },
      { label: savedForLater ? 'Remove from later' : 'Save for later', onClick: () => void plexState.toggleListenLater({ ratingKey: a.ratingKey, title: a.title, artist: a.artist, thumb: a.thumb ?? null, year: a.year ?? null }) },
      { label: hasOverride ? 'Change cover…' : 'Choose cover…', onClick: () => plexState.coverArt.open(a.ratingKey, a.artist, a.title, mbReleaseMbid) }
    ]
  }

  function trackCtxItems(t: { ratingKey: string; title: string; artist: string }): ContextMenuEntry[] {
    return [
      { label: 'Play Now', onClick: () => void plexState.playback.requestCastTrack(t.ratingKey, t.title, t.artist) },
      ...queueMenuItems('track', t.ratingKey, t.title, t.artist)
    ]
  }

  function fmtDur(ms: number | null): string {
    if (!ms) return ''
    const total = Math.round(ms / 1000)
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  let sentinelEl = $state<HTMLDivElement | null>(null)
  let sectionEl = $state<HTMLElement | null>(null)
  let observer: IntersectionObserver | null = null

  function onScroll(e: Event): void {
    plexState.libraryScrollY = (e.currentTarget as HTMLElement).scrollTop
  }

  onMount(async () => {
    await tick()
    if (sectionEl && plexState.libraryScrollY > 0) {
      sectionEl.scrollTop = plexState.libraryScrollY
    }
  })

  $effect(() => {
    if (!sentinelEl) return
    observer?.disconnect()
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && canLoadMore && !searchActive) {
          void plexState.loadMoreAlbums()
        }
      }
    }, { rootMargin: '400px' })
    observer.observe(sentinelEl)
    return () => {
      observer?.disconnect()
      observer = null
    }
  })

  onDestroy(() => {
    observer?.disconnect()
    observer = null
  })
</script>

<svelte:window onkeydown={onGlobalKey} />

<section bind:this={sectionEl} onscroll={onScroll}>
  <ScreenHeader kicker="library" title={ctx?.name ?? '…'} sub={headerSub} bind:height={headerHeight}>
    {#snippet search()}
    <div class="search-wrap">
      <svg class="search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <input
        bind:this={searchEl}
        class="search-input"
        type="search"
        placeholder="Search library…"
        value={searchQuery}
        oninput={(e) => plexState.search.setQuery((e.currentTarget as HTMLInputElement).value)}
        aria-label="Search library"
      />
      {#if searchActive}
        <button class="search-clear" onclick={() => plexState.search.clear()} aria-label="Clear search" title="Clear (Esc)">×</button>
      {:else}
        <kbd class="search-kbd">⌘K</kbd>
      {/if}
    </div>
    {/snippet}
    {#snippet actions()}
      {#if sections.length > 1}
        <span class="select-shell">
          <select
            value={activeSection ?? ''}
            onchange={(e) => plexState.selectSection((e.currentTarget as HTMLSelectElement).value)}
          >
            {#each sections as s (s.key)}
              <option value={s.key}>{s.title}</option>
            {/each}
          </select>
        </span>
      {/if}
      <label class="sort">
        <span class="sort-label">sort</span>
        <select
          value={sortKey}
          onchange={(e) => void plexState.setSort((e.currentTarget as HTMLSelectElement).value as typeof sortKey)}
        >
          {#each SORT_OPTIONS as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </label>
      <button
        class="secondary dice"
        onpointerdown={onDicePointerDown}
        title="Hold to shuffle — release to land on an album"
        aria-label="Hold to shuffle"
      >
        <span class="dice-glyph" aria-hidden="true">⚄</span>
      </button>
      <div class="size-control" title="Cover size">
        <span class="size-icon size-icon-sm" aria-hidden="true"></span>
        <input
          type="range"
          min={COVER_SIZE_MIN}
          max={COVER_SIZE_MAX}
          step="10"
          value={coverSize}
          oninput={(e) => plexState.setCoverSize(Number((e.currentTarget as HTMLInputElement).value))}
          aria-label="Cover size"
        />
        <span class="size-icon size-icon-lg" aria-hidden="true"></span>
      </div>
    {/snippet}
  </ScreenHeader>

  {#if searchActive}
    {#if searchLoading && !searchResults}
      <p class="hint">searching…</p>
    {:else if searchError}
      <p class="error">{searchError}</p>
    {:else if searchResults && searchResults.artists.length === 0 && searchResults.albums.length === 0 && searchResults.tracks.length === 0}
      <p class="hint">no matches for "{searchQuery}".</p>
    {:else if searchResults}
      {#if searchResults.artists.length > 0}
        <div class="section-label">artists</div>
        <ul class="artist-row">
          {#each searchResults.artists as a (a.ratingKey)}
            <li>
              <button
                type="button"
                class="artist-chip"
                title={a.title}
                onclick={() => void plexState.openSearchArtist(a.title)}
              >{a.title}</button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if searchResults.albums.length > 0}
        <div class="section-label">albums</div>
        <ul class="grid" data-grid="albums" style="--cover-size: {coverSize}px;">
          {#each searchResults.albums as album (album.ratingKey)}
            <li>
              <AlbumCard
                {album}
                size={thumbRequestSize}
                oncontextmenu={(e) => {
                  e.preventDefault()
                  plexState.openContextMenu(e.clientX, e.clientY, albumCtxItems(album))
                }}
              />
            </li>
          {/each}
        </ul>
      {/if}
      {#if searchResults.tracks.length > 0}
        <div class="section-label">tracks</div>
        <div class="track-list">
          {#each searchResults.tracks as t (t.ratingKey)}
            <button
              type="button"
              class="track-row"
              onclick={() => void plexState.playback.requestCastTrack(t.ratingKey, t.title, t.artist)}
              oncontextmenu={(e) => { e.preventDefault(); plexState.openContextMenu(e.clientX, e.clientY, trackCtxItems(t)) }}
            >
              {#if t.thumb}
                <img src={plexState.thumbUrl(t.thumb, 80, t.albumRatingKey) ?? ''} alt="" class="track-thumb" loading="lazy" />
              {:else}
                <div class="track-thumb-fallback"></div>
              {/if}
              <div class="track-meta">
                <div class="track-title">{t.title}</div>
                <div class="track-sub">{t.artist}{t.album ? ` · ${t.album}` : ''}</div>
              </div>
              <span class="track-dur">{fmtDur(t.duration)}</span>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  {:else if loading && albums.length === 0}
    <FocusBar />
    <p class="hint">loading library…</p>
  {:else if error}
    <FocusBar />
    <p class="error">{error}</p>
  {:else}
    <FocusBar />
    <!-- Two columns from here down: the crate rail and everything else. The
         rail sits outside the empty-state branch so picking a crate with no
         matches still leaves you somewhere to click. -->
    <div class="lib-body" style="--rail-top: {headerHeight}px;">
      <CrateRail />
      <div class="lib-main">
    {#if albums.length === 0}
      <p class="hint">no albums found.</p>
    {:else}
      {#if !anyFilterActive}
        {@const SIX_MONTHS_SECS = 6 * 30 * 24 * 60 * 60}
        {@const THIRTY_DAYS_SECS = 30 * 24 * 60 * 60}
        {@const NOW_SECS = Math.floor(Date.now() / 1000)}

        <div class="dig">
          <span class="dig-label">dig</span>
          <div class="dig-chips">
            {#each digChips as c (c.id)}
              <button
                class="dig-chip"
                class:dig-chip-open={activeShelf === c.id}
                onclick={() => toggleShelf(c.id)}
                aria-expanded={activeShelf === c.id}
                disabled={c.count === 0}
              >
                <span>{c.label}</span>
                {#if c.count !== null}<span class="dig-count">{c.count}</span>{/if}
              </button>
            {/each}
          </div>
          <button
            class="aotd-link"
            class:aotd-link-open={activeShelf === 'aotd'}
            onclick={() => toggleShelf('aotd')}
            aria-expanded={activeShelf === 'aotd'}
          >album of the day →</button>
        </div>

        <!--
          The four rails always render so they compute their counts even when
          collapsed. hideHeading=true keeps the dig strip as the sole
          interactive surface; expanded={...} lets the chip control whether the
          row of albums shows up, directly under the strip.
        -->
        <RecentAlbumsRail
          hideHeading
          expanded={activeShelf === 'recent'}
          bind:count={countRecent}
        />
        <EditorialRail
          title="neglected gems"
          filter={(a) =>
            (a.rating ?? 0) >= 8 &&
            (a.lastViewedAt === null || NOW_SECS - a.lastViewedAt > SIX_MONTHS_SECS)}
          sort="rating"
          hideHeading
          expanded={activeShelf === 'neglected'}
          bind:count={countNeglected}
        />
        <EditorialRail
          title="five-star vault"
          filter={(a) => (a.rating ?? 0) >= 9}
          sort="rating"
          hideHeading
          expanded={activeShelf === 'fivestar'}
          bind:count={countFiveStar}
        />
        <EditorialRail
          title="never spun"
          filter={(a) =>
            (a.viewCount ?? 0) === 0 && NOW_SECS - (a.addedAt ?? NOW_SECS) > THIRTY_DAYS_SECS}
          sort="added"
          hideHeading
          expanded={activeShelf === 'neverspun'}
          bind:count={countNeverSpun}
        />
        {#if activeShelf === 'moods'}<MoodStations />{/if}
        {#if activeShelf === 'years'}<YearScrubRail />{/if}
        {#if activeShelf === 'aotd'}<AlbumOfTheDay />{/if}
      {/if}
      <div class="meta">
        {#if anyFilterActive}
          {#if clientFilterActive && allAlbumsLoading && !allAlbums}
            loading full library…
          {:else if clientFilterActive}
            {albums.length.toLocaleString()} album{albums.length === 1 ? '' : 's'} matching filters
          {:else}
            {paginatedAlbums.length.toLocaleString()} of {total.toLocaleString()} matching albums
          {/if}
        {:else}
          {paginatedAlbums.length} of {total} albums
        {/if}
      </div>
      <ul class="grid" data-grid="albums" style="--cover-size: {coverSize}px;">
        {#each albums as album (album.ratingKey)}
          <li>
            <AlbumCard
              {album}
              size={thumbRequestSize}
              markPlayed
              oncontextmenu={(e) => {
                e.preventDefault()
                plexState.openContextMenu(e.clientX, e.clientY, albumCtxItems(album))
              }}
            />
          </li>
        {/each}
      </ul>
      {#if albums.length < total}
        <div class="sentinel" bind:this={sentinelEl}>
          {#if loadingMore}loading more…{:else}scroll to load more{/if}
        </div>
      {/if}
    {/if}
      </div>
    </div>
  {/if}

  {#if session?.signedIn}
    <footer>signed in as {session.user.title || session.user.username}</footer>
  {/if}
</section>

<ShuffleSlotMachine bind:this={slotMachine} />

<style>
  /* The crate rail and the listing sit side by side. `section` is the
     scroller and a flex column with its own gap, so .lib-main restates that
     gap for the children that moved inside it. */
  .lib-body {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
  }
  .lib-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }
  /* One card holding every way into the library that isn't the grid itself.
     Replaced four shelf pills + mood stations + album of the day + the year
     scrubber, which between them pushed the albums below the fold. */
  .dig {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    flex-wrap: wrap;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: 0.75rem 1rem;
    margin: 0 0 0.4rem;
  }
  .dig-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--faded);
    font-weight: 700;
    flex-shrink: 0;
  }
  .dig-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    min-width: 0;
  }
  .dig-chip {
    background: var(--paper);
    border: 1px solid var(--hairline);
    color: var(--walnut);
    padding: 0.35rem 0.85rem;
    border-radius: var(--radius-pill);
    font: inherit;
    font-size: 0.78rem;
    text-transform: lowercase;
    letter-spacing: 0.03em;
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    cursor: pointer;
    transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
  }
  .dig-chip:hover:not(:disabled) {
    color: var(--espresso);
    border-color: var(--hairline-strong);
  }
  .dig-chip-open {
    color: var(--surface);
    background: var(--espresso);
    border-color: var(--espresso);
  }
  .dig-chip-open:hover { background: var(--walnut); border-color: var(--walnut); }
  .dig-chip:disabled { opacity: 0.4; cursor: default; }
  .dig-count {
    font-size: 0.7rem;
    opacity: 0.6;
  }
  .aotd-link {
    margin-left: auto;
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    font-size: 0.78rem;
    color: var(--faded);
    cursor: pointer;
    white-space: nowrap;
    transition: color 120ms ease;
  }
  .aotd-link:hover, .aotd-link-open { color: var(--brick); }

  section {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    /* No top padding — it would pin the sticky ScreenHeader below the visible
       top and open a see-through strip (see ScreenHeader's styles). It also
       kept CrateRail's `top: headerHeight` math honest only by accident. */
    padding: 0 2rem 1rem;
    box-sizing: border-box;
    overflow-y: auto;
    background: var(--paper);
  }
  /* The header itself now lives in ScreenHeader — including the kicker/title
     type and the not-draggable rule. What stays here is the styling for the
     controls Library passes into its search/actions slots. */
  .search-wrap {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    max-width: 440px;
    background: var(--inset);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    padding: 0.45rem 0.95rem;
    transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
  }
  .search-wrap:focus-within {
    border-color: var(--brick);
    background: var(--inset);
    box-shadow: 0 0 0 4px var(--brick-wash);
  }
  .search-icon { color: var(--faded); flex-shrink: 0; }
  .search-input {
    background: transparent;
    border: 0;
    outline: none;
    color: var(--espresso);
    font: inherit;
    font-size: 0.9rem;
    flex: 1;
    min-width: 0;
    padding: 0;
  }
  .search-input::placeholder { color: var(--faded); }
  .search-input::-webkit-search-cancel-button { display: none; }
  .search-clear {
    background: transparent;
    border: 0;
    color: var(--faded);
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
    padding: 0 0.15rem;
    border-radius: var(--radius-pill);
  }
  .search-clear:hover { color: var(--espresso); }
  .search-kbd {
    color: var(--faded);
    font-size: 0.7rem;
    font-family: inherit;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: 0.05rem 0.3rem;
  }
  select {
    /* appearance: none because the native arrow hugs the right border —
       ~4px inset against the text's 10px inset, which reads lopsided. The
       replacement chevron is the wrapper's ::after (a select can't host
       pseudo-elements), drawn with borders so it matches the 1.4-stroke
       SVG chevrons used elsewhere and takes its color from a theme token. */
    -webkit-appearance: none;
    appearance: none;
    background: var(--inset);
    color: var(--espresso);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: 0.4rem 1.8rem 0.4rem 0.65rem;
    font-size: 0.83rem;
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease;
  }
  select:hover { border-color: var(--hairline-strong); background: var(--surface); }
  .sort {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .select-shell { display: inline-flex; }
  /* Both select wrappers draw the same chevron over their select's right
     padding. pointer-events: none so it never eats the click. */
  .sort,
  .select-shell {
    position: relative;
  }
  .sort::after,
  .select-shell::after {
    content: '';
    position: absolute;
    right: 0.8rem;
    top: 50%;
    width: 6px;
    height: 6px;
    border-right: 1.4px solid var(--walnut);
    border-bottom: 1.4px solid var(--walnut);
    transform: translateY(-70%) rotate(45deg);
    pointer-events: none;
  }
  .sort-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--faded);
  }
  .secondary {
    background: transparent;
    color: var(--walnut);
    border: 1px solid var(--hairline);
    padding: 0.42rem 0.95rem;
    border-radius: var(--radius-pill);
    font-size: 0.78rem;
    cursor: pointer;
    transition: color 140ms ease, border-color 140ms ease, background 140ms ease, transform 80ms ease;
  }
  .secondary:hover {
    color: var(--espresso);
    border-color: var(--hairline-strong);
    background: var(--surface);
  }
  .secondary:active { transform: scale(0.97); }
  .meta {
    color: var(--faded);
    font-size: 0.78rem;
    letter-spacing: 0.02em;
    font-variant-numeric: tabular-nums;
  }
  .hint { color: var(--faded); }
  .error { color: var(--err-fg); }
  .grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--cover-size, 180px), 1fr));
    gap: calc(var(--cover-size, 180px) * 0.18) calc(var(--cover-size, 180px) * 0.1);
  }
  .grid li { min-width: 0; }
  .size-control {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.7rem;
    background: var(--inset);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    transition: border-color 120ms ease, background 120ms ease;
  }
  .size-control:hover { border-color: var(--hairline-strong); background: var(--surface); }
  .size-control input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100px;
    height: 3px;
    background: var(--hairline);
    border-radius: var(--radius-pill);
    outline: none;
    cursor: ew-resize;
  }
  .size-control input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--brick);
    cursor: ew-resize;
    border: 0;
  }
  .size-icon {
    display: inline-block;
    background: var(--faded);
    border-radius: var(--radius-xs);
  }
  .size-icon-sm { width: 8px; height: 8px; }
  .size-icon-lg { width: 14px; height: 14px; }
  footer {
    margin-top: auto;
    color: var(--faded);
    font-size: 0.7rem;
    padding-top: 1rem;
  }
  .section-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--faded);
    margin-top: 0.5rem;
  }
  .artist-row {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .artist-chip {
    display: inline-block;
    background: var(--surface);
    border: 1px solid var(--hairline);
    color: var(--espresso);
    font: inherit;
    font-size: 0.82rem;
    padding: 0.35rem 0.85rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .artist-chip:hover {
    background: var(--surface-deep);
    border-color: var(--walnut);
  }
  .artist-chip:focus-visible {
    outline: 2px solid var(--walnut);
    outline-offset: 2px;
  }
  .track-list {
    display: flex;
    flex-direction: column;
  }
  .track-row {
    display: grid;
    grid-template-columns: 40px 1fr auto;
    gap: 0.75rem;
    padding: 0.5rem 0.25rem;
    border: none;
    border-bottom: 1px solid var(--hairline);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    align-items: center;
    cursor: pointer;
    transition: background 100ms ease;
  }
  .track-row:hover {
    background: var(--surface);
  }
  .track-row:focus-visible {
    outline: 2px solid var(--walnut);
    outline-offset: -2px;
  }
  .track-thumb, .track-thumb-fallback {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    object-fit: cover;
    background: var(--surface-deep);
  }
  .track-meta { min-width: 0; }
  .track-title {
    font-size: 0.9rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--espresso);
  }
  .track-sub {
    font-size: 0.78rem;
    color: var(--walnut);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .track-dur {
    color: var(--faded);
    font-size: 0.82rem;
    font-variant-numeric: tabular-nums;
  }
  .sentinel {
    text-align: center;
    padding: 1.5rem 0 2.5rem;
    color: var(--faded);
    font-size: 0.8rem;
  }
  .dice {
    padding: 0.32rem 0.7rem;
    line-height: 1;
    user-select: none;
  }
  .dice:active { transform: scale(0.92); }
  .dice-glyph {
    font-size: 1.15rem;
    color: var(--brick);
  }
</style>
