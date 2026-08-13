<script lang="ts">
  import { plexState, splitAlbumMbids } from '../lib/plex-state.svelte'
  import { PUBLIC_BUILD } from '../../../shared/build-flags'
  import { queueMenuItems } from '../lib/queue-menu'
  import BookletLightbox from '../lib/BookletLightbox.svelte'
  import AlbumViewShell from '../lib/album-view/AlbumViewShell.svelte'
  import { albumFacts } from '../lib/album-view/helpers'
  import AlbumFacts from '../lib/album-view/AlbumFacts.svelte'
  import AlbumMeta from '../lib/album-view/AlbumMeta.svelte'
  import UpcomingShowsCallout from '../lib/album-view/UpcomingShowsCallout.svelte'
  import AlbumTrackList from '../lib/album-view/AlbumTrackList.svelte'
  import AlbumCredits from '../lib/album-view/AlbumCredits.svelte'
  import AlbumDiscography from '../lib/album-view/AlbumDiscography.svelte'
  import LabelRail from '../lib/album-view/LabelRail.svelte'
  import SimilarArtistsRail from '../lib/album-view/SimilarArtistsRail.svelte'

  const loader = $derived(plexState.openAlbumLoader)
  const detail = $derived(loader.album)
  const loading = $derived(loader.albumLoading)
  const error = $derived(loader.albumError)
  const credits = $derived(loader.credits)
  const creditsLoading = $derived(loader.creditsLoading)
  const creditsError = $derived(loader.creditsError)
  // Bio-vs-summary, original-year and media-info resolution all live on the
  // loader now, shared with the now-playing screen (see AlbumDetailLoader).
  const hasPlexSummary = $derived(loader.hasPlexSummary)
  const bio = $derived(loader.effectiveBio)
  const bioLoading = $derived(loader.effectiveBioLoading)
  const originalYear = $derived(loader.effectiveOriginalYear)
  const mediaInfo = $derived(loader.effectiveMediaInfo)
  const facts = $derived(
    detail ? albumFacts(detail, mediaInfo, originalYear, credits?.originalDate ?? null) : []
  )

  // The right column is tabbed rather than one long scroll — the bio alone can
  // run several hundred words, which used to push the track list off the
  // screen on first open.
  type TabId = 'tracks' | 'credits' | 'lyrics' | 'releases'
  const TABS: { id: TabId; label: string }[] = [
    { id: 'tracks', label: 'Tracks' },
    { id: 'credits', label: 'Credits' },
    { id: 'lyrics', label: 'Lyrics' },
    { id: 'releases', label: 'Releases' }
  ]
  // Tab + the album it belongs to, held together in one value and *derived*
  // rather than reset by an $effect.
  //
  // The reset rule is "a different album starts on Tracks". Expressing that as
  // an effect means writing `tab` from inside an effect that also reads state
  // the template renders, which is the classic way to wedge a Svelte 5
  // component: the loader swaps `detail` as each cascade stage lands, so the
  // effect re-entered constantly and reactivity could give out — after which
  // the tab buttons stop responding entirely. Deriving it can't loop.
  let tabChoice = $state<{ key: string | null; tab: TabId }>({ key: null, tab: 'tracks' })
  const albumKey = $derived(detail?.album.ratingKey ?? null)
  const tab = $derived(tabChoice.key === albumKey ? tabChoice.tab : 'tracks')
  function setTab(id: TabId): void {
    tabChoice = { key: albumKey, tab: id }
  }

  // Album lyrics, assembled from the per-track cache the loader already
  // prefetches on open (same payload Theater mode uses). Tracks with nothing
  // cached, still loading, or errored are simply absent.
  const albumLyrics = $derived.by(() => {
    if (!detail) return []
    const out: { ratingKey: string; title: string; text: string; instrumental: boolean }[] = []
    for (const t of detail.tracks) {
      const entry = plexState.lyrics.byTrack[t.ratingKey]
      if (!entry || entry === 'loading' || entry === 'error') continue
      const text = entry.plainLyrics ?? ''
      if (!text && !entry.instrumental) continue
      out.push({
        ratingKey: t.ratingKey,
        title: t.title,
        text,
        instrumental: entry.instrumental
      })
    }
    return out
  })

  // Is the album-wide prefetch still working? A track is pending when it has
  // no cache entry at all (not yet picked up by a worker) or is mid-flight.
  // Without this the Lyrics tab claimed "no lyrics found" for the first
  // several seconds of every cold album, which is a lie — the pool was still
  // draining, and a track that falls through to a Genius scrape can take 15s.
  const lyricsPending = $derived.by(() => {
    if (!detail) return false
    return detail.tracks.some((t) => {
      const entry = plexState.lyrics.byTrack[t.ratingKey]
      return entry === undefined || entry === 'loading'
    })
  })

  const phase = $derived(loading ? 'loading' : error ? 'error' : detail ? 'ready' : 'loading')

  $effect(() => {
    if (detail) void plexState.ensureAllAlbumsLoaded()
  })

  const booklet = $derived(loader.booklet)
  const bookletLoading = $derived(loader.bookletLoading)
  let lightboxIndex = $state<number | null>(null)
  const bookletHeading = $derived.by(() => {
    if (!booklet || booklet.length === 0) return 'booklet'
    const types = new Set<string>()
    for (const img of booklet) for (const t of img.types) types.add(t)
    if (types.has('Booklet')) return 'booklet'
    if (types.has('Liner')) return 'liner notes'
    if (types.has('Back') || types.has('Tray')) return 'back cover'
    return 'artwork'
  })

  let pendingDelete = $state(false)
  let disarmTimer: number | null = null
  const deletingRk = $derived(plexState.deletingRatingKey)

  function armDelete(): void {
    pendingDelete = true
    if (disarmTimer !== null) window.clearTimeout(disarmTimer)
    disarmTimer = window.setTimeout(() => {
      pendingDelete = false
      disarmTimer = null
    }, 4000)
  }

  async function confirmDelete(): Promise<void> {
    pendingDelete = false
    if (disarmTimer !== null) {
      window.clearTimeout(disarmTimer)
      disarmTimer = null
    }
    const d = detail
    if (!d) return
    const result = await plexState.deleteAlbumFromLibrary(d.album.ratingKey, null)
    if (result) plexState.closeAlbumDetail()
  }

  const labelRail = $derived(plexState.openAlbumLoader.labelRail)
  const labelRailNames = $derived(plexState.openAlbumLoader.labelRailNames)
  const labelRailLoading = $derived(plexState.openAlbumLoader.labelRailLoading)
  const similar = $derived(plexState.openAlbumLoader.similarArtists)
  const similarLoading = $derived(plexState.openAlbumLoader.similarArtistsLoading)

  const albumLabels = $derived(
    detail
      ? plexState.labelAliases.canonicalize(
          plexState.labelIndex.labels[detail.album.ratingKey] ?? []
        )
      : []
  )

  function close(): void {
    void plexState.goBack()
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
  }

  function playTrack(trackRatingKey: string): void {
    if (!detail) return
    void plexState.playback.requestCastAlbumFromTrack(
      detail.album.ratingKey,
      trackRatingKey,
      detail.album.title,
      detail.album.artist
    )
  }

  function onAlbumContextMenu(e: MouseEvent): void {
    if (!detail) return
    e.preventDefault()
    const { ratingKey, title, artist, thumb, year } = detail.album
    const mbReleaseMbid = credits?.releaseMbid ?? splitAlbumMbids(detail.guids).release ?? null
    const hasOverride = !!plexState.coverArt.overrides[ratingKey]
    const savedForLater = plexState.isInListenLater(ratingKey)
    plexState.openContextMenu(e.clientX, e.clientY, [
      { label: 'Play Now', onClick: () => void plexState.playback.requestCastAlbum(ratingKey, title, artist) },
      ...queueMenuItems('album', ratingKey, title, artist),
      { separator: true },
      { label: savedForLater ? 'Remove from later' : 'Save for later', onClick: () => void plexState.toggleListenLater({ ratingKey, title, artist, thumb, year }) },
      { label: hasOverride ? 'Change cover…' : 'Choose cover…', onClick: () => plexState.coverArt.open(ratingKey, artist, title, mbReleaseMbid) }
    ])
  }

  function onTrackContextMenu(e: MouseEvent, trackKey: string, trackTitle: string): void {
    if (!detail) return
    e.preventDefault()
    const { ratingKey: albumKey, title: albumTitle, artist } = detail.album
    plexState.openContextMenu(e.clientX, e.clientY, [
      {
        label: 'Play Now',
        onClick: () => void plexState.playback.requestCastAlbumFromTrack(albumKey, trackKey, albumTitle, artist)
      },
      ...queueMenuItems('track', trackKey, trackTitle, artist)
    ])
  }
</script>

<svelte:window onkeydown={onKey} />

<AlbumViewShell {detail} {phase} {error} coverViewTransition onArtContextMenu={onAlbumContextMenu}>
  {#snippet header()}
    <button class="back-btn" onclick={close} aria-label="Back" title="Back (Esc)">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    </button>
  {/snippet}

  {#snippet artBelow()}
    <AlbumFacts {facts} />
  {/snippet}

  {#snippet body()}
    {#if detail}
      <AlbumMeta {detail} {credits} {bio} {bioLoading} {hasPlexSummary} {originalYear} {mediaInfo}>
        {#snippet afterChips()}
          <UpcomingShowsCallout artistName={detail.album.artist} />
        {/snippet}
      </AlbumMeta>

      <nav class="tabs" aria-label="Album sections">
        {#each TABS as t (t.id)}
          <button
            class="tab"
            class:tab-active={tab === t.id}
            aria-current={tab === t.id ? 'true' : undefined}
            onclick={() => setTab(t.id)}
          >{t.label}</button>
        {/each}
      </nav>

      {#if tab === 'tracks'}
        <AlbumTrackList
          tracks={detail.tracks}
          {credits}
          albumArtist={detail.album.artist}
          albumTitle={detail.album.title}
          onTrackClick={playTrack}
          {onTrackContextMenu}
        />

        <!-- Delete sits under the track list, not in the credits block where it
             used to live: once the right column became tabbed, anything parked
             in Credits was invisible unless you went looking. Tracks is the tab
             you land on, and the end of the track list is the right altitude —
             past everything, where you've already decided. (Library write, so
             the public build never renders it.) -->
        {#if !PUBLIC_BUILD}
          <div class="album-actions">
            {#if pendingDelete}
              <button
                class="danger-btn confirm"
                disabled={deletingRk === detail.album.ratingKey}
                onclick={() => void confirmDelete()}
              >click again to delete</button>
            {:else}
              <button
                class="danger-btn"
                disabled={deletingRk === detail.album.ratingKey}
                title="Unlink the album's files via the tagger and refresh Plex"
                onclick={armDelete}
              >{deletingRk === detail.album.ratingKey ? 'deleting…' : 'delete album'}</button>
            {/if}
          </div>
        {/if}

      {:else if tab === 'credits'}
        <AlbumCredits {detail} {credits} {creditsLoading} {creditsError} />

      {:else if tab === 'lyrics'}
        {#if albumLyrics.length === 0 && lyricsPending}
          <p class="hint">looking up lyrics…</p>
        {:else if albumLyrics.length === 0}
          <p class="hint">no lyrics found for this album.</p>
        {:else}
          <div class="lyrics-tab">
            {#each albumLyrics as l (l.ratingKey)}
              <section class="lyric-block">
                <h3 class="lyric-title">{l.title}</h3>
                {#if l.instrumental}
                  <p class="hint">instrumental</p>
                {:else}
                  <pre class="lyric-text">{l.text}</pre>
                {/if}
              </section>
            {/each}
            {#if lyricsPending}
              <p class="hint">still looking up the rest…</p>
            {/if}
          </div>
        {/if}
      {:else}
        {#if albumLabels.length > 0}
          <div class="labels-row">
            <span class="label-tag">label</span>
            {#each albumLabels as name (name)}
              <button
                class="label-pill"
                onclick={() => plexState.openLabelEntity(name)}
                title={`See all albums on ${name}`}
              >{name}</button>
            {/each}
          </div>
        {/if}

        <AlbumDiscography {detail} />

        {#if bookletLoading && (!booklet || booklet.length === 0)}
          <div class="rail-slot">
            <div class="rail-label">{bookletHeading}</div>
            <p class="hint">looking up booklet on cover art archive…</p>
          </div>
        {:else if booklet && booklet.length > 0}
          <div class="rail-slot">
            <div class="rail-label">{bookletHeading}</div>
            <ul class="booklet-rail">
              {#each booklet as img, i (img.id)}
                <li>
                  <button
                    class="booklet-thumb"
                    onclick={() => (lightboxIndex = i)}
                    title={img.types.join(' · ') + (img.comment ? ` — ${img.comment}` : '')}
                  >
                    <img src={img.thumbUrl} alt={img.types.join(', ')} loading="lazy" />
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <LabelRail rail={labelRail} names={labelRailNames} loading={labelRailLoading} />
        <SimilarArtistsRail {similar} loading={similarLoading} />
      {/if}
    {/if}
  {/snippet}

  {#snippet footer()}
    {#if booklet && lightboxIndex !== null}
      <BookletLightbox
        images={booklet}
        index={lightboxIndex}
        onClose={() => (lightboxIndex = null)}
        onIndex={(i) => (lightboxIndex = i)}
      />
    {/if}
  {/snippet}
</AlbumViewShell>

<style>
  .tabs {
    display: flex;
    gap: 1.1rem;
    margin: 1.4rem 0 1rem;
    border-bottom: 1px solid var(--hairline);
  }
  .tab {
    background: none;
    border: 0;
    padding: 0 0 0.5rem;
    margin-bottom: -1px;
    font: inherit;
    font-size: 0.81rem;
    color: var(--faded);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .tab:hover { color: var(--walnut); }
  .tab-active {
    color: var(--espresso);
    font-weight: 600;
    border-bottom-color: var(--brick);
  }
  .lyrics-tab {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
  }
  .lyric-title {
    margin: 0 0 0.4rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--espresso);
  }
  .lyric-text {
    margin: 0;
    font: inherit;
    font-size: 0.85rem;
    line-height: 1.55;
    color: var(--walnut);
    white-space: pre-wrap;
  }

  .back-btn {
    -webkit-app-region: no-drag;
    width: 38px;
    height: 38px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--surface) 75%, transparent);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    color: var(--espresso);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    cursor: pointer;
    padding: 0;
    transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 80ms ease;
  }
  .back-btn:hover {
    background: var(--surface);
    border-color: var(--hairline-strong);
    color: var(--espresso);
  }
  .back-btn:active {
    transform: scale(0.95);
  }
  .back-btn:focus-visible {
    outline: 2px solid var(--brick);
    outline-offset: 2px;
  }
  /* Right-aligned and quiet: reachable without hunting, but it shouldn't be
     the thing your eye lands on when the track list ends. */
  .album-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 1.25rem;
  }
  .danger-btn {
    background: transparent;
    border: 1px solid var(--warn-border);
    color: var(--err-fg);
    font-size: 0.72rem;
    padding: 0.25rem 0.7rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
  }
  .danger-btn:hover:not(:disabled) {
    border-color: var(--err-fg);
    background: var(--warn-bg);
  }
  .danger-btn.confirm {
    background: var(--warn-bg);
    border-color: var(--err-fg);
  }
  .danger-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .labels-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.75rem;
  }
  .label-tag {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--faded);
    margin-right: 0.2rem;
  }
  .label-pill {
    background: var(--ink-tint-04);
    border: 1px solid var(--ink-tint-08);
    color: var(--espresso);
    font-size: 0.78rem;
    padding: 0.2rem 0.65rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: border-color 140ms ease, color 140ms ease, background 140ms ease, transform 80ms ease;
  }
  .label-pill:hover {
    border-color: rgba(140, 53, 34, 0.5);
    color: var(--brick);
    background: var(--brick-wash);
  }
  .label-pill:active {
    transform: scale(0.97);
  }
  .rail-slot {
    margin-top: 2.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--ink-tint-04);
  }
  .rail-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--faded);
    font-weight: 500;
    margin-bottom: 0.9rem;
  }
  ul.booklet-rail {
    list-style: none;
    padding: 0 0 0.6rem;
    margin: 0;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 160px;
    gap: 0.85rem;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--ink-tint-12) transparent;
  }
  ul.booklet-rail::-webkit-scrollbar {
    height: 8px;
  }
  ul.booklet-rail::-webkit-scrollbar-thumb {
    background: var(--ink-tint-12);
    border-radius: var(--radius-pill);
  }
  .booklet-thumb {
    background: var(--surface);
    border: 1px solid var(--ink-tint-08);
    border-radius: var(--radius-md);
    padding: 0;
    width: 100%;
    aspect-ratio: 1 / 1;
    overflow: hidden;
    cursor: zoom-in;
    transition: border-color 140ms ease, transform 120ms ease, box-shadow 140ms ease;
    display: block;
  }
  .booklet-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .booklet-thumb:hover {
    border-color: rgba(140, 53, 34, 0.5);
    transform: translateY(-2px);
    box-shadow: 0 10px 24px rgba(43, 29, 18, 0.18);
  }
  .booklet-thumb:active {
    transform: translateY(0) scale(0.98);
  }
  .hint {
    color: var(--faded);
    font-size: 0.85rem;
    margin: 0;
  }
</style>
