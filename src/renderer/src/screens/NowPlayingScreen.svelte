<script lang="ts">
  import { plexState, splitAlbumMbids } from '../lib/plex-state.svelte'
  import { queueMenuItems } from '../lib/queue-menu'
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

  const tl = $derived(plexState.playback.timeline)
  const loader = $derived(plexState.nowPlayingAlbumLoader)
  const detail = $derived(loader.album)
  const loading = $derived(loader.albumLoading)
  const error = $derived(loader.albumError)
  const credits = $derived(loader.credits)
  const creditsLoading = $derived(loader.creditsLoading)
  const creditsError = $derived(loader.creditsError)
  // Bio-vs-summary, original-year and media-info resolution all live on the
  // loader now, shared with the album-detail screen (see AlbumDetailLoader).
  const hasPlexSummary = $derived(loader.hasPlexSummary)
  const bio = $derived(loader.effectiveBio)
  const bioLoading = $derived(loader.effectiveBioLoading)
  const originalYear = $derived(loader.effectiveOriginalYear)
  const activeTrackKey = $derived(tl?.ratingKey ?? null)
  const mediaInfo = $derived(loader.effectiveMediaInfo)
  const facts = $derived(
    detail ? albumFacts(detail, mediaInfo, originalYear, credits?.originalDate ?? null) : []
  )

  const phase = $derived(
    !tl ? 'empty' : loading && !detail ? 'loading' : error ? 'error' : detail ? 'ready' : 'loading'
  )

  const labelRail = $derived(plexState.nowPlayingAlbumLoader.labelRail)
  const labelRailNames = $derived(plexState.nowPlayingAlbumLoader.labelRailNames)
  const labelRailLoading = $derived(plexState.nowPlayingAlbumLoader.labelRailLoading)
  const similar = $derived(plexState.nowPlayingAlbumLoader.similarArtists)
  const similarLoading = $derived(plexState.nowPlayingAlbumLoader.similarArtistsLoading)

  // If the currently-playing album changes while this screen is open, pull the
  // new album in. Pure timeline-driven — no navigation coupling.
  $effect(() => {
    if (!plexState.nowPlayingOpen) return
    const albumKey = tl?.albumRatingKey
    if (albumKey) void plexState.ensureNowPlayingAlbum(albumKey, { fromTimeline: true })
  })

  $effect(() => {
    if (detail) void plexState.ensureAllAlbumsLoaded()
  })

  const upNextAlbum = $derived.by(() => {
    const snap = plexState.playback.queueSnapshot
    if (!snap || snap.items.length === 0) return null
    const currentAlbumKey = tl?.albumRatingKey ?? null
    let cursor = -1
    if (snap.selectedItemID !== null) {
      cursor = snap.items.findIndex((it) => it.playQueueItemID === snap.selectedItemID)
    }
    if (cursor < 0) cursor = snap.items.findIndex((it) => it.ratingKey === tl?.ratingKey)
    if (cursor < 0) cursor = 0
    for (let i = cursor + 1; i < snap.items.length; i++) {
      const it = snap.items[i]
      if (it.albumRatingKey && it.albumRatingKey !== currentAlbumKey) {
        return {
          albumRatingKey: it.albumRatingKey,
          title: it.album || it.title,
          artist: it.artist,
          thumb: it.thumb
        }
      }
    }
    return null
  })
  const upNextThumb = $derived(
    plexState.thumbUrl(upNextAlbum?.thumb ?? null, 160, upNextAlbum?.albumRatingKey ?? null)
  )

  function openUpNext(): void {
    if (!upNextAlbum) return
    void plexState.openAlbumDetail(upNextAlbum.albumRatingKey)
    plexState.closeNowPlaying()
  }

  function close(): void {
    plexState.closeNowPlaying()
  }

  function onKey(e: KeyboardEvent): void {
    // Theater mode stacks above this screen and owns Escape while open —
    // both handlers are window-level, so guard or one Esc closes both.
    if (e.key === 'Escape' && !plexState.theaterOpen) close()
  }

  async function onTrackClick(trackRatingKey: string): Promise<void> {
    if (!detail) return
    // Prefer in-queue skip so the existing queue (and any surrounding items
    // the user queued up) stay intact. Fall back to a fresh queue only when
    // the track isn't in the current queue.
    const jumped = await plexState.playback.skipToTrackInQueue(trackRatingKey)
    if (jumped) return
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
    const { ratingKey, title, artist } = detail.album
    const mbReleaseMbid = credits?.releaseMbid ?? splitAlbumMbids(detail.guids).release ?? null
    const hasOverride = !!plexState.coverArt.overrides[ratingKey]
    plexState.openContextMenu(e.clientX, e.clientY, [
      { label: 'Play Now', onClick: () => void plexState.playback.requestCastAlbum(ratingKey, title, artist) },
      ...queueMenuItems('album', ratingKey, title, artist),
      { separator: true },
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

<AlbumViewShell
  {detail}
  {phase}
  {error}
  emptyText="nothing is playing."
  onArtContextMenu={onAlbumContextMenu}
>
  {#snippet header()}
    <button class="back-btn" onclick={close} aria-label="Close Now Playing" title="Close (Esc)">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </button>
    <div class="header-title">Now Playing</div>
  {/snippet}

  {#snippet artBelow()}
    <AlbumFacts {facts} />
  {/snippet}

  {#snippet body()}
    {#if detail}
      <AlbumMeta {detail} {credits} {bio} {bioLoading} {hasPlexSummary} {originalYear} {mediaInfo}>
        {#snippet afterChips()}
          <UpcomingShowsCallout artistName={tl?.artist} />
        {/snippet}
      </AlbumMeta>

      <AlbumDiscography {detail} />

      <AlbumTrackList
        tracks={detail.tracks}
        {credits}
        albumArtist={detail.album.artist}
        albumTitle={detail.album.title}
        genres={detail.genres}
        {activeTrackKey}
        {onTrackClick}
        {onTrackContextMenu}
      />

      <AlbumCredits {detail} {credits} {creditsLoading} {creditsError} />

      <LabelRail rail={labelRail} names={labelRailNames} loading={labelRailLoading} />
      <SimilarArtistsRail {similar} loading={similarLoading} />
    {/if}
  {/snippet}

  {#snippet footer()}
    {#if upNextAlbum}
      <button class="up-next" onclick={openUpNext} title="Open next album">
        <div class="up-next-label">Up next</div>
        <div class="up-next-body">
          {#if upNextThumb}
            <img src={upNextThumb} alt="" />
          {:else}
            <div class="up-next-ph"></div>
          {/if}
          <div class="up-next-meta">
            <div class="up-next-title">{upNextAlbum.title}</div>
            <div class="up-next-artist">{upNextAlbum.artist}</div>
          </div>
        </div>
      </button>
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
  .header-title {
    -webkit-app-region: no-drag;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--faded);
  }
  .up-next {
    position: fixed;
    bottom: 96px;
    right: 1.25rem;
    z-index: 45;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.7rem 0.85rem;
    /* Fixed dark surface in every theme — re-scope the ink tokens the same
       way QueuePanel does, so the title isn't dark-on-dark on a light theme.
       The accent is left alone so it still follows the theme. */
    --espresso: rgba(255, 255, 255, 0.92);
    --faded: rgba(255, 255, 255, 0.58);
    --ink-tint-08: rgba(255, 255, 255, 0.13);
    --hairline: rgba(255, 255, 255, 0.14);
    background: rgba(18, 18, 22, 0.92);
    border: 1px solid var(--ink-tint-08);
    border-radius: var(--radius-xl);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: 0 12px 32px rgba(var(--shadow-color), 0.22);
    cursor: pointer;
    text-align: left;
    max-width: 260px;
    color: inherit;
    transition: border-color 140ms ease, transform 120ms ease, background 140ms ease;
  }
  .up-next:hover {
    border-color: color-mix(in srgb, var(--brick) 40%, transparent);
    background: rgba(24, 24, 30, 0.96);
  }
  .up-next:active {
    transform: translateY(1px);
  }
  .up-next:focus-visible {
    outline: 2px solid var(--brick);
    outline-offset: 3px;
  }
  .up-next-label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--faded);
  }
  .up-next-body {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-width: 0;
  }
  .up-next img,
  .up-next-ph {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-sm);
    object-fit: cover;
    flex-shrink: 0;
    box-shadow: 0 4px 12px rgba(var(--shadow-color), 0.18);
  }
  .up-next-ph {
    background: var(--hairline);
  }
  .up-next-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .up-next-title {
    color: var(--espresso);
    font-size: 0.9rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .up-next-artist {
    color: var(--faded);
    font-size: 0.78rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
