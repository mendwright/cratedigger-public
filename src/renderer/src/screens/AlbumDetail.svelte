<script lang="ts">
  import { plexState, splitAlbumMbids } from '../lib/plex-state.svelte'
  import { PUBLIC_BUILD } from '../../../shared/build-flags'
  import { queueMenuItems } from '../lib/queue-menu'
  import BookletLightbox from '../lib/BookletLightbox.svelte'
  import AlbumViewShell from '../lib/album-view/AlbumViewShell.svelte'
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

  {#snippet body()}
    {#if detail}
      <AlbumMeta {detail} {credits} {bio} {bioLoading} {hasPlexSummary} {originalYear} {mediaInfo}>
        {#snippet afterChips()}
          <UpcomingShowsCallout artistName={detail.album.artist} />
        {/snippet}
      </AlbumMeta>

      <AlbumDiscography {detail} />

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

      <AlbumTrackList
        tracks={detail.tracks}
        {credits}
        albumArtist={detail.album.artist}
        albumTitle={detail.album.title}
        onTrackClick={playTrack}
        {onTrackContextMenu}
      />

      <AlbumCredits {detail} {credits} {creditsLoading} {creditsError}>
        {#snippet extraActions()}
          {#if PUBLIC_BUILD}
            <!-- delete (library write) is stripped from the public build -->
          {:else if pendingDelete}
            <button
              class="match-btn danger confirm"
              disabled={deletingRk === detail.album.ratingKey}
              onclick={() => void confirmDelete()}
            >click again to delete</button>
          {:else}
            <button
              class="match-btn danger"
              disabled={deletingRk === detail.album.ratingKey}
              title="Unlink the album's files via the tagger and refresh Plex"
              onclick={armDelete}
            >{deletingRk === detail.album.ratingKey ? 'deleting…' : 'delete album'}</button>
          {/if}
        {/snippet}
      </AlbumCredits>

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
