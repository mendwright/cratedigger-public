<script lang="ts">
  import { onMount } from 'svelte'
  import type { PlexAlbum } from '../../../shared/plex'
  import { plexState } from './plex-state.svelte'
  import { coverTransitionInFlight, registerCoverTransition } from './cover-transition'

  interface Props {
    album: PlexAlbum
    size?: number
    showMeta?: boolean
    markPlayed?: boolean
    onclick?: (album: PlexAlbum) => void
    oncontextmenu?: (e: MouseEvent, album: PlexAlbum) => void
  }

  const {
    album,
    size = 320,
    showMeta = true,
    markPlayed = false,
    onclick,
    oncontextmenu
  }: Props = $props()

  // The currently-playing album: glow + EQ overlay; clicking jumps to the
  // Now Playing screen instead of the static album detail. Reads the live
  // timeline state so the cue moves with the queue.
  const isPlaying = $derived(
    !!plexState.playback.timeline &&
      plexState.playback.timeline.albumRatingKey === album.ratingKey &&
      (plexState.playback.timeline.state === 'playing' || plexState.playback.timeline.state === 'paused')
  )
  const isLive = $derived(isPlaying && plexState.playback.timeline?.state === 'playing')

  // "Recently played" cue. The cover itself stays fully vivid — the whole
  // point of the grid is to showcase the art — so recency rides in a small
  // corner pill instead of dimming/desaturating the image (which it used to).
  // Only shown when the host opts in (the main library grid does; rails like
  // RecentAlbumsRail or AlbumDetail's label rail do not — they'd badge every
  // card, which carries no signal). Window is 180 days; the currently-playing
  // album skips the cue so its own now-playing badge stays unambiguous. The
  // pill's background fades with age (recent = more opaque) so there's still a
  // gentle recency gradient, but never on the art.
  const PLAYED_DAYS = 180
  const playedCue = $derived.by((): { label: string; style: string } | null => {
    if (!markPlayed || isPlaying) return null
    const last = album.lastViewedAt
    if (!last) return null
    const daysSince = (Date.now() / 1000 - last) / 86400
    if (daysSince >= PLAYED_DAYS || daysSince < 0) return null
    const t = daysSince / PLAYED_DAYS
    const alpha = (0.72 - t * 0.3).toFixed(3)
    return { label: formatPlayedAgo(daysSince), style: `background:rgba(20,14,8,${alpha});` }
  })

  function formatPlayedAgo(days: number): string {
    if (days < 1) return 'today'
    if (days < 7) return `${Math.max(1, Math.round(days))}d`
    if (days < 28) return `${Math.round(days / 7)}w`
    return `${Math.round(days / 30)}mo`
  }

  let cardEl: HTMLElement | undefined = $state()
  let mediaRequested = false

  const src = $derived(plexState.thumbUrl(album.thumb, size, album.ratingKey))
  const label = $derived(plexState.labelIndex.labels[album.ratingKey]?.[0] ?? null)
  const metaParts = $derived(
    showMeta
      ? [album.year ? String(album.year) : null, label].filter((p): p is string => !!p)
      : []
  )
  const mediaInfo = $derived(plexState.mediaInfo.byAlbum[album.ratingKey] ?? null)
  const formatBadge = $derived(formatBadgeFor(mediaInfo))

  onMount(() => {
    if (!cardEl) return
    // Only request the media-info (codec/bitrate for the format badge) when
    // the card actually scrolls into view; firing for every mounted card
    // floods Plex and starves cover-image transcodes.
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !mediaRequested) {
            mediaRequested = true
            plexState.mediaInfo.request(album.ratingKey)
            obs.disconnect()
            break
          }
        }
      },
      { rootMargin: '200px' }
    )
    obs.observe(cardEl)
    return () => obs.disconnect()
  })

  function formatBadgeFor(
    info: typeof mediaInfo
  ): { label: string; lossless: boolean } | null {
    if (!info?.codec) return null
    const c = info.codec.toLowerCase()
    const lossless = c === 'flac' || c === 'alac' || c === 'wav' || c === 'aiff'
    if (lossless) return { label: c.toUpperCase(), lossless: true }
    if (c === 'mp3' || c === 'aac' || c === 'ogg' || c === 'opus') {
      const kbps =
        info.avgBitrate && info.avgBitrate > 0 ? ` ${Math.round(info.avgBitrate)}` : ''
      return { label: `${c.toUpperCase()}${kbps}`, lossless: false }
    }
    return { label: c.toUpperCase(), lossless: false }
  }

  function handleClick(): void {
    if (onclick) {
      onclick(album)
      return
    }
    if (isPlaying) {
      plexState.openNowPlaying()
      return
    }
    // View Transitions API: tag this card's cover with the shared
    // `album-cover-active` name and wrap the open in startViewTransition so the
    // cover morphs into the AlbumDetail hero image. The morph is coordinated in
    // cover-transition.ts — only one runs at a time (skip if one's in flight,
    // fall through to a plain open) and the nav/close path flushes it before a
    // back/close swap so the snapshot can't strand on the top layer. Browsers
    // without the API also fall through.
    const doc = document as Document & {
      startViewTransition?: (cb: () => void | Promise<void>) => {
        finished?: Promise<unknown>
        skipTransition?: () => void
      }
    }
    if (typeof doc.startViewTransition === 'function' && cardEl && !coverTransitionInFlight()) {
      const coverEl = cardEl.querySelector('.cover img, .cover .cover-fallback') as
        | HTMLElement
        | null
      if (coverEl) coverEl.style.viewTransitionName = 'album-cover-active'
      const transition = doc.startViewTransition(() =>
        plexState.openAlbumDetail(album.ratingKey)
      )
      registerCoverTransition(transition)
      // Clear the leaked inline name once it settles, in case this card
      // survived the swap (it normally unmounts, making this a no-op).
      const clearName = (): void => {
        if (coverEl) coverEl.style.viewTransitionName = ''
      }
      void Promise.resolve(transition?.finished).then(clearName, clearName)
      return
    }
    void plexState.openAlbumDetail(album.ratingKey)
  }

  function handleContext(e: MouseEvent): void {
    if (oncontextmenu) oncontextmenu(e, album)
  }

  // Hover-prefetch: 120ms dwell warms the detail payload into an LRU.
  // The click itself then opens instantly with no loading flash. 120ms is
  // long enough to skip drive-by hovers (mouse sweeping across the grid)
  // and short enough that any user actually pointing at a card has it
  // ready by the time their finger comes down. Don't prefetch the
  // currently-playing card — clicking it goes to NowPlaying, not detail.
  let hoverTimer: number | null = null
  function onPointerEnter(): void {
    if (isPlaying || hoverTimer !== null) return
    hoverTimer = window.setTimeout(() => {
      hoverTimer = null
      plexState.prefetchAlbumDetail(album.ratingKey)
    }, 120)
  }
  function onPointerLeave(): void {
    if (hoverTimer !== null) {
      window.clearTimeout(hoverTimer)
      hoverTimer = null
    }
  }
</script>

<button
  bind:this={cardEl}
  class="card"
  data-card="album"
  class:playing={isPlaying}
  onclick={handleClick}
  oncontextmenu={handleContext}
  onpointerenter={onPointerEnter}
  onpointerleave={onPointerLeave}
>
  <div class="cover" class:playing={isPlaying}>
    {#if src}
      <img src={src} alt={album.title} loading="lazy" decoding="async" />
    {:else}
      <div class="cover-fallback">{album.title.slice(0, 1)}</div>
    {/if}
    {#if playedCue}
      <span class="played-badge" style={playedCue.style} aria-label={`played ${playedCue.label} ago`}>
        {playedCue.label}
      </span>
    {/if}
    {#if isPlaying}
      <span class="now-playing" class:paused={!isLive} aria-label={isLive ? 'now playing' : 'paused'}>
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar"></span>
      </span>
    {/if}
    {#if formatBadge}
      <span
        class="format-badge"
        class:lossless={formatBadge.lossless}
        title={mediaInfo?.avgBitrate ? `~${Math.round(mediaInfo.avgBitrate)} kbps avg` : undefined}
      >{formatBadge.label}</span>
    {/if}
  </div>
  <div class="title" title={album.title}>{album.title}</div>
  <div class="artist" title={album.artist}>{album.artist}</div>
  {#if metaParts.length > 0}
    <div class="meta" title={metaParts.join(' · ')}>{metaParts.join(' · ')}</div>
  {/if}
</button>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
    width: 100%;
    padding: 0;
    background: transparent;
    border: 0;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }
  .card:focus-visible { outline: 2px solid var(--brick); outline-offset: 4px; border-radius: var(--radius-lg); }
  /* The cover is staged inside its implied sleeve. .cover is the stage:
     overflow:visible so the sleeve can peek out top on hover; the image
     itself owns the rounded corners + shadow so it reads as a physical
     thing the user can pick up. */
  .cover {
    aspect-ratio: 1 / 1;
    border-radius: var(--radius-sm);
    position: relative;
    isolation: isolate;
  }
  /* Implied cardboard sleeve — sits behind the cover, slightly taller, with
     a darker open top so when the cover slides up there's something there.
     Stays put while the cover lifts (that's the whole point of the metaphor:
     records come out of sleeves, sleeves don't move). */
  .cover::before {
    content: '';
    position: absolute;
    inset: -3% -2% -1%;
    border-radius: var(--radius-xs);
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--espresso) 55%, transparent) 0%,
      color-mix(in srgb, var(--espresso) 22%, transparent) 14%,
      color-mix(in srgb, var(--surface-deep) 88%, var(--espresso) 12%) 26%,
      var(--surface-deep) 100%
    );
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    z-index: 0;
    pointer-events: none;
  }
  .cover img,
  .cover-fallback {
    position: relative;
    z-index: 1;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-deep);
    box-shadow: 0 6px 14px rgba(var(--shadow-color), 0.18);
    transition:
      transform var(--dur-base) var(--ease-spring),
      box-shadow var(--dur-base) var(--ease-out);
  }
  .card:hover .cover img,
  .card:hover .cover-fallback {
    transform: translateY(-9%);
    box-shadow:
      0 16px 32px rgba(var(--shadow-color), 0.32),
      0 0 0 1px var(--hairline);
  }
  .cover.playing img,
  .cover.playing .cover-fallback {
    box-shadow:
      0 0 0 2px var(--brick),
      0 16px 32px color-mix(in srgb, var(--brick) 22%, transparent);
  }
  .card:hover .cover.playing img,
  .card:hover .cover.playing .cover-fallback {
    box-shadow:
      0 0 0 2px var(--brick),
      0 18px 36px color-mix(in srgb, var(--brick) 38%, transparent),
      0 0 0 3px var(--brick-wash);
  }
  .now-playing {
    position: absolute;
    bottom: 0.55rem;
    left: 0.55rem;
    display: inline-flex;
    align-items: flex-end;
    gap: 3px;
    height: 18px;
    padding: 4px 6px 3px;
    /* Deliberately theme-independent: this chip sits on album art, so it
       matches .format-badge's fixed ink rather than following a token. */
    background: rgba(20, 14, 8, 0.72);
    border-radius: var(--radius-sm);
    backdrop-filter: blur(4px);
    pointer-events: none;
    z-index: 2;
    transition: transform var(--dur-base) var(--ease-spring);
  }
  .card:hover .cover .now-playing { transform: translateY(-9%); }
  .now-playing .bar {
    width: 3px;
    background: var(--brick);
    border-radius: 1px;
    animation: np-bounce 0.95s ease-in-out infinite;
    transform-origin: bottom;
  }
  .now-playing .bar:nth-child(1) { animation-delay: -0.4s; }
  .now-playing .bar:nth-child(2) { animation-delay: -0.7s; }
  .now-playing .bar:nth-child(3) { animation-delay: -0.15s; }
  .now-playing.paused .bar {
    animation-play-state: paused;
    height: 6px !important;
  }
  @keyframes np-bounce {
    0%, 100% { height: 4px; }
    50%      { height: 13px; }
  }
  .cover img {
    width: 100%;
    /* Square the image off its own definite width, not the parent's
       aspect-ratio-derived height. `height: 100%` here resolved to `auto`
       for non-square source art (bootlegs, scans, odd remasters), letting
       the image render at its natural size — a tall cover then overflowed
       the cell and overlapped its neighbours (`.cover` is overflow:visible
       for the hover lift, so nothing clipped it). aspect-ratio + object-fit
       crops any source into the square regardless of parent height. */
    aspect-ratio: 1 / 1;
    height: auto;
    object-fit: cover;
    display: block;
  }
  .cover-fallback {
    width: 100%;
    aspect-ratio: 1 / 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--whisper);
    font-size: 2.5rem;
    font-weight: 700;
  }
  /* Sits on top of album art (any theme), so colors are fixed instead of
     theme-relative — otherwise dark themes flip the foreground onto the
     same-tone background and the badge disappears. */
  .format-badge {
    position: absolute;
    top: 0.45rem;
    right: 0.45rem;
    z-index: 2;
    transition: transform var(--dur-base) var(--ease-spring);
    padding: 0.15rem 0.4rem;
    font-size: clamp(0.55rem, calc(var(--cover-size, 180px) * 0.045), 0.7rem);
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--inset);
    background: rgba(20, 14, 8, 0.72);
    border: 1px solid rgba(255, 251, 239, 0.22);
    border-radius: var(--radius-pill);
    backdrop-filter: blur(4px);
    line-height: 1.1;
    pointer-events: none;
  }
  /* Inverted variant, same reasoning: fixed ink on a fixed light chip. */
  .format-badge.lossless {
    color: #140e08;
    background: rgba(255, 251, 239, 0.92);
    border-color: rgba(20, 14, 8, 0.4);
  }
  .card:hover .cover .format-badge { transform: translateY(-9%); }
  /* Recently-played pill — top-left so it clears the format badge (top-right)
     and the now-playing meter (bottom-left). Fixed light-on-dark colors like
     the format badge so it stays legible on any cover in any theme. */
  .played-badge {
    position: absolute;
    top: 0.45rem;
    left: 0.45rem;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: transform var(--dur-base) var(--ease-spring);
    padding: 0.15rem 0.42rem 0.15rem 0.38rem;
    font-size: clamp(0.55rem, calc(var(--cover-size, 180px) * 0.045), 0.7rem);
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--inset);
    border: 1px solid rgba(255, 251, 239, 0.18);
    border-radius: var(--radius-pill);
    backdrop-filter: blur(4px);
    line-height: 1.1;
    pointer-events: none;
  }
  .played-badge::before {
    content: '';
    width: 0;
    height: 0;
    border-style: solid;
    border-width: 3px 0 3px 5px;
    border-color: transparent transparent transparent currentColor;
    opacity: 0.9;
  }
  .card:hover .cover .played-badge { transform: translateY(-9%); }
  .title {
    font-size: clamp(0.78rem, calc(var(--cover-size, 180px) * 0.075), 1.05rem);
    font-weight: 500;
    color: var(--espresso);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-clamp: 2;
    overflow: hidden;
    word-break: break-word;
    line-height: 1.25;
  }
  .artist {
    font-size: clamp(0.7rem, calc(var(--cover-size, 180px) * 0.065), 0.92rem);
    color: var(--walnut);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-clamp: 2;
    overflow: hidden;
    word-break: break-word;
    line-height: 1.25;
  }
  .meta {
    font-size: clamp(0.65rem, calc(var(--cover-size, 180px) * 0.055), 0.82rem);
    color: var(--faded);
    margin-top: -0.15rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.25;
  }
</style>
