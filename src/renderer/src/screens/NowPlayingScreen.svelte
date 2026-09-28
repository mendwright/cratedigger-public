<script lang="ts">
  import type { ArtistBio, Bio } from '../../../shared/plex'
  import { safeExternalHref } from '../../../shared/urls'
  import { plexState, splitAlbumMbids } from '../lib/plex-state.svelte'
  import { radioSongInfo } from '../lib/radio-song-info.svelte'
  import { radioStationArt } from '../lib/radio-stations'
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

  // Station radio (Pi target): no Plex album exists, so the album-view shell
  // has nothing to load — render a dedicated view instead: big art (iTunes
  // song lookup, same source the kiosk uses), song, and a clickable artist
  // that opens their discography via the MB entity page.
  const isRadio = $derived(
    !!tl && (tl.ratingKey.startsWith('radio:') || tl.ratingKey.startsWith('sxm:'))
  )
  // Shared with the bottom bar's thumbnail — one lookup, one image.
  $effect(() => {
    if (isRadio) radioSongInfo.ensure(tl?.artist, tl?.title)
  })
  const radioInfo = $derived(radioSongInfo.current)

  // Artist bio + album description for the radio view, so the listener can
  // read about whoever's on air without leaving the screen. The artist bio
  // needs an MBID (library first, MB name search fallback); the album
  // description works from artist + title alone via Last.fm.
  let radioArtistBio = $state<ArtistBio | null>(null)
  let radioArtistBioLoading = $state(false)
  let radioArtistBioKey = ''
  $effect(() => {
    if (!isRadio || !tl?.artist) return
    const artist = tl.artist
    if (artist === radioArtistBioKey) return
    radioArtistBioKey = artist
    radioArtistBio = null
    radioArtistBioLoading = true
    void (async () => {
      const mbid = await plexState.resolveArtistMbidByName(artist)
      if (radioArtistBioKey !== artist) return
      const bio = mbid
        ? await window.cratedigger.plex.getArtistBio({ mbid, name: artist }).catch(() => null)
        : null
      if (radioArtistBioKey !== artist) return
      radioArtistBio = bio
      radioArtistBioLoading = false
    })()
  })

  let radioAlbumBio = $state<Bio | null>(null)
  let radioAlbumBioKey = ''
  $effect(() => {
    const album = radioInfo?.album
    if (!isRadio || !tl?.artist || !album) return
    const key = `${tl.artist}|${album}`
    if (key === radioAlbumBioKey) return
    radioAlbumBioKey = key
    radioAlbumBio = null
    void window.cratedigger.plex
      .getAlbumBio({ releaseMbid: null, releaseGroupMbid: null, artist: tl.artist, title: album })
      .then((b) => {
        if (radioAlbumBioKey === key) radioAlbumBio = b
      })
      .catch(() => {})
  })

  function openRadioArtist(): void {
    const artist = tl?.artist
    if (!artist) return
    plexState.closeNowPlaying()
    void plexState.openArtistByName(artist)
  }

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

{#if isRadio && tl}
  <!-- Same shell as the album screens — sticky art left, body right — with the
       iTunes art standing in for the Plex cover. What can't be shared is the
       Plex-only body (tracks, credits, facts): radio gets song/artist/bios. -->
  <AlbumViewShell detail={null} phase="ready" artSrc={tl.artUrl ?? radioInfo?.art ?? radioStationArt(tl)} artTitle={tl.title}>
    {#snippet header()}
      <button class="back-btn" onclick={close} aria-label="Close Now Playing" title="Close (Esc)">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      <div class="header-title">Now Playing</div>
    {/snippet}

    {#snippet body()}
      {#snippet bioAttr(b: Bio)}
        {@const href = safeExternalHref(b.url)}
        <div class="radio-bio-attr">
          {#if b.source === 'wikipedia'}
            from {#if href}<a {href} target="_blank" rel="noreferrer">Wikipedia</a>{:else}Wikipedia{/if}
            · CC BY-SA
          {:else}
            from {#if href}<a {href} target="_blank" rel="noreferrer">Last.fm</a>{:else}Last.fm{/if}
          {/if}
        </div>
      {/snippet}

      <div class="radio-label">{tl.album}</div>
      <h1 class="radio-h1">{tl.title}</h1>
      <div class="radio-sub">
        {#if tl.artist}
          <button class="radio-artist-link" onclick={openRadioArtist} title="See {tl.artist}'s discography">{tl.artist}</button>
        {/if}
        {#if radioInfo?.album}
          <span class="radio-from">· from “{radioInfo.album}”</span>
        {/if}
      </div>

      {#if radioAlbumBio && radioInfo?.album}
        <div class="radio-bio-block">
          <div class="radio-bio-label">About “{radioInfo.album}”</div>
          <p class="radio-bio-text">{radioAlbumBio.text}</p>
          {@render bioAttr(radioAlbumBio)}
        </div>
      {/if}
      {#if radioArtistBio}
        <div class="radio-bio-block">
          <div class="radio-bio-label">About {tl.artist}</div>
          <p class="radio-bio-text">{radioArtistBio.text}</p>
          {@render bioAttr(radioArtistBio)}
        </div>
      {:else if radioArtistBioLoading}
        <div class="radio-bio-block">
          <p class="radio-bio-text radio-bio-hint">looking up {tl.artist}…</p>
        </div>
      {/if}
    {/snippet}
  </AlbumViewShell>
{:else}
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
{/if}

<style>
  /* Mirrors AlbumMeta's label / h1 / sub / artist-link so radio reads as the
     same screen as an album. Styles are duplicated (not shared) because
     AlbumMeta's are component-scoped — keep the values in step. */
  .radio-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--faded);
    margin-bottom: 0.4rem;
  }
  .radio-h1 {
    font-family: var(--font-display);
    font-size: clamp(1.85rem, 3.6vw, 2.8rem);
    font-weight: 700;
    letter-spacing: -0.015em;
    margin: 0;
    line-height: 1.05;
    color: var(--espresso);
  }
  .radio-sub {
    color: var(--faded);
    font-size: 0.95rem;
    margin-top: 0.4rem;
  }
  .radio-artist-link {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--brick);
    font: inherit;
    cursor: pointer;
    border-bottom: 1px solid transparent;
  }
  .radio-artist-link:hover {
    border-bottom-color: currentColor;
  }
  .radio-artist-link:focus-visible {
    outline: 2px solid var(--brick);
    outline-offset: 2px;
  }
  .radio-from {
    color: var(--faded);
  }
  .radio-bio-block {
    margin-top: 1.6rem;
    max-width: 58ch;
  }
  .radio-bio-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--faded);
    margin-bottom: 0.35rem;
  }
  .radio-bio-text {
    margin: 0;
    color: var(--espresso);
    font-size: 0.92rem;
    line-height: 1.55;
    white-space: pre-wrap;
  }
  .radio-bio-hint {
    color: var(--faded);
    font-style: italic;
  }
  .radio-bio-attr {
    margin-top: 0.4rem;
    font-size: 0.72rem;
    color: var(--faded);
  }
  .radio-bio-attr a {
    color: var(--faded);
  }
  .radio-bio-attr a:hover {
    color: var(--espresso);
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
