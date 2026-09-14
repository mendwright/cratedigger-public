<script lang="ts">
  import { plexState } from '../lib/plex-state.svelte'
  import { groupCredits } from '../lib/album-view/helpers'
  import { parseLrc, activeLrcIndex } from '../../../shared/lrc'
  import type { LyricsResult } from '../../../shared/plex'

  const tl = $derived(plexState.playback.timeline)
  const loader = $derived(plexState.nowPlayingAlbumLoader)
  const detail = $derived(loader.album)
  const credits = $derived(loader.credits)

  const coverSrc = $derived(
    plexState.thumbUrl(tl?.thumb ?? null, 1200, tl?.albumRatingKey ?? null)
  )

  // Theater only makes sense while something is playing — if playback stops
  // entirely (timeline gone), fold back to whatever was underneath.
  $effect(() => {
    if (!tl) plexState.closeTheater()
  })

  // Track changes (radio, queue advance) keep the album loader in sync, same
  // contract as NowPlayingScreen.
  $effect(() => {
    const albumKey = tl?.albumRatingKey
    if (albumKey) void plexState.ensureNowPlayingAlbum(albumKey, { fromTimeline: true })
  })

  // Warm the lyrics cache for whatever is playing.
  $effect(() => {
    if (!tl) return
    void plexState.lyrics.ensure({
      trackRatingKey: tl.ratingKey,
      artist: tl.artist,
      title: tl.title,
      album: tl.album,
      durationMs: tl.duration || null
    })
  })

  const lyricsEntry = $derived(tl ? plexState.lyrics.byTrack[tl.ratingKey] : undefined)
  const lyrics = $derived(
    lyricsEntry && lyricsEntry !== 'loading' && lyricsEntry !== 'error'
      ? (lyricsEntry as LyricsResult)
      : null
  )
  const syncedLines = $derived(lyrics?.syncedLyrics ? parseLrc(lyrics.syncedLyrics) : [])

  // Local smooth clock between 2.5s timeline polls — same anchor/re-anchor
  // scheme as the transport bar (NowPlaying.svelte), tighter tick because the
  // active lyric line rides on it.
  let tickNow = $state(performance.now())
  let baseTime = 0
  let baseAt = 0
  let baseRatingKey: string | null = null

  $effect(() => {
    if (!tl) {
      baseRatingKey = null
      return
    }
    const next = tl.time
    if (tl.ratingKey !== baseRatingKey) {
      baseRatingKey = tl.ratingKey
      baseTime = next
      baseAt = performance.now()
      return
    }
    const projected = baseTime + (performance.now() - baseAt)
    if (Math.abs(projected - next) > 1500) {
      baseTime = next
      baseAt = performance.now()
    }
  })

  $effect(() => {
    if (!tl || tl.state !== 'playing') return
    const id = window.setInterval(() => {
      tickNow = performance.now()
    }, 250)
    return () => clearInterval(id)
  })

  const liveTime = $derived.by(() => {
    if (!tl) return 0
    if (tl.state !== 'playing') return baseTime
    return Math.min(tl.duration || Infinity, baseTime + (tickNow - baseAt))
  })
  const activeIdx = $derived(syncedLines.length > 0 ? activeLrcIndex(syncedLines, liveTime) : -1)

  // Auto-scroll the active line to center — unless the pointer is inside the
  // lyrics pane (the user is reading ahead; don't yank the scroll position).
  let lyricsEl = $state<HTMLDivElement | null>(null)
  let lyricsHovered = $state(false)
  $effect(() => {
    if (activeIdx < 0 || !lyricsEl || lyricsHovered) return
    const el = lyricsEl.querySelector(`[data-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })

  // Credits for the active track only. Reuse the album-view grouping (role
  // ordering, instrument rows) by feeding it an AlbumCredits narrowed to the
  // playing track.
  const trackCredits = $derived.by(() => {
    if (!credits || !tl) return []
    const forTrack = credits.byTrack[tl.ratingKey]
    if (!forTrack || forTrack.length === 0) return []
    return groupCredits({
      ...credits,
      releaseLevel: [],
      byTrack: { [tl.ratingKey]: forTrack },
      trackArtists: {}
    })
  })

  // Theater etiquette: fade the cursor (and the close affordance) after a few
  // seconds of stillness.
  let idle = $state(false)
  let idleTimer: number | null = null
  function onPointerMove(): void {
    idle = false
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => {
      idle = true
    }, 3500)
  }
  $effect(() => {
    onPointerMove()
    return () => {
      if (idleTimer !== null) clearTimeout(idleTimer)
    }
  })

  function onKey(e: KeyboardEvent): void {
    // Keyboard-help overlay sits above theater; let its Escape win.
    if (e.key === 'Escape' && !plexState.keyboardHelpOpen) plexState.closeTheater()
  }

  function openPerson(mbid: string, name: string): void {
    plexState.closeTheater()
    void plexState.openEntity(mbid, name)
  }

  const albumYear = $derived(
    detail && detail.album.ratingKey === tl?.albumRatingKey
      ? (loader.effectiveOriginalYear ?? detail.album.year)
      : null
  )
</script>

<svelte:window onkeydown={onKey} />

{#if tl}
  <div class="theater" class:idle role="presentation" onpointermove={onPointerMove}>
    {#if coverSrc}
      <img class="backdrop" src={coverSrc} alt="" />
    {/if}
    <div class="scrim"></div>

    <button class="close" onclick={() => plexState.closeTheater()} aria-label="Close theater mode" title="Close (Esc)">✕</button>

    <div class="stage">
      <div class="cover-side">
        {#if coverSrc}
          <img class="cover" src={coverSrc} alt="" />
        {:else}
          <div class="cover cover-ph"></div>
        {/if}
      </div>

      <div class="info-side">
        <div class="track-block">
          <div class="track-title">{tl.title || '—'}</div>
          <div class="track-sub">
            {tl.artist}{tl.album ? ` · ${tl.album}` : ''}{albumYear ? ` · ${albumYear}` : ''}
          </div>
        </div>

        <div
          class="lyrics"
          bind:this={lyricsEl}
          role="presentation"
          onpointerenter={() => (lyricsHovered = true)}
          onpointerleave={() => (lyricsHovered = false)}
        >
          {#if syncedLines.length > 0}
            {#each syncedLines as line, i (i)}
              <div class="lyric-line" class:active={i === activeIdx} class:past={i < activeIdx} data-idx={i}>
                {line.text || '♪'}
              </div>
            {/each}
          {:else if lyrics?.plainLyrics}
            <pre class="plain-lyrics">{lyrics.plainLyrics}</pre>
          {:else if lyrics?.instrumental}
            <div class="lyrics-note">instrumental</div>
          {:else if lyricsEntry === 'loading'}
            <div class="lyrics-note">finding lyrics…</div>
          {:else}
            <div class="lyrics-note">no lyrics found</div>
          {/if}
        </div>

        {#if trackCredits.length > 0}
          <div class="credits">
            <div class="credits-heading">on this track</div>
            {#each trackCredits as g (g.role + g.label)}
              <div class="credit-row">
                <span class="credit-label">{g.label}</span>
                <span class="credit-people">
                  {#each [...g.people.entries()] as [mbid, name], i (mbid)}
                    {#if i > 0}<span class="credit-sep">·</span>{/if}
                    <button class="credit-person" onclick={() => openPerson(mbid, name)}>{name}</button>
                  {/each}
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .theater {
    position: fixed;
    inset: 0;
    z-index: 48; /* under the transport bar (50) — it stays usable */
    background: #0c0b0d;
    overflow: hidden;
    animation: theater-in 320ms ease-out;
  }
  .theater.idle {
    cursor: none;
  }
  @keyframes theater-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .backdrop {
    position: absolute;
    inset: -8%;
    width: 116%;
    height: 116%;
    object-fit: cover;
    filter: blur(64px) saturate(1.15) brightness(0.42);
    transform: scale(1.05);
  }
  .scrim {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 30% 40%, rgba(12, 11, 13, 0) 0%, rgba(12, 11, 13, 0.55) 100%),
      linear-gradient(to bottom, rgba(12, 11, 13, 0.25), rgba(12, 11, 13, 0.65));
  }
  .close {
    position: absolute;
    top: 1.1rem;
    right: 1.25rem;
    z-index: 2;
    width: 38px;
    height: 38px;
    border-radius: var(--radius-pill);
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(18, 18, 22, 0.55);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.95rem;
    cursor: pointer;
    transition: opacity 400ms ease, background 140ms ease;
    -webkit-app-region: no-drag;
  }
  .close:hover { background: rgba(30, 30, 36, 0.8); color: #fff; }
  .theater.idle .close { opacity: 0; }
  .stage {
    position: relative;
    z-index: 1;
    height: 100%;
    display: grid;
    grid-template-columns: minmax(280px, 44%) minmax(0, 1fr);
    gap: clamp(1.5rem, 4vw, 4rem);
    align-items: center;
    padding: 3rem clamp(1.5rem, 5vw, 5rem);
    /* Clear the fixed transport bar */
    padding-bottom: 110px;
  }
  .cover-side {
    display: flex;
    justify-content: center;
  }
  .cover {
    width: 100%;
    max-width: min(38vw, 62vh);
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: var(--radius-lg);
    box-shadow:
      0 24px 80px rgba(0, 0, 0, 0.55),
      0 0 0 1px rgba(255, 255, 255, 0.08);
  }
  .cover-ph { background: rgba(255, 255, 255, 0.06); }
  .info-side {
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
    min-width: 0;
    height: 100%;
    max-height: calc(100vh - 3rem - 110px);
    justify-content: center;
  }
  .track-block { flex-shrink: 0; }
  .track-title {
    font-size: clamp(1.5rem, 2.8vw, 2.4rem);
    font-weight: 650;
    color: rgba(255, 255, 255, 0.96);
    line-height: 1.15;
    text-wrap: balance;
  }
  .track-sub {
    margin-top: 0.4rem;
    font-size: clamp(0.9rem, 1.3vw, 1.05rem);
    color: rgba(255, 255, 255, 0.55);
  }
  .lyrics {
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 1.25rem 1.25rem 1.25rem 0;
    /* Soft top/bottom fade so lines drift in and out instead of clipping */
    mask-image: linear-gradient(to bottom, transparent 0, #000 2.2rem, #000 calc(100% - 2.2rem), transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 2.2rem, #000 calc(100% - 2.2rem), transparent 100%);
    scrollbar-width: none;
  }
  .lyrics::-webkit-scrollbar { display: none; }
  .lyric-line {
    font-size: clamp(1.05rem, 1.8vw, 1.5rem);
    font-weight: 550;
    line-height: 1.5;
    padding: 0.28rem 0;
    color: rgba(255, 255, 255, 0.34);
    transition: color 300ms ease, transform 300ms ease;
    transform-origin: left center;
  }
  .lyric-line.past { color: rgba(255, 255, 255, 0.22); }
  .lyric-line.active {
    color: rgba(255, 255, 255, 0.98);
    transform: scale(1.03);
  }
  .plain-lyrics {
    margin: 0;
    font: inherit;
    font-size: clamp(0.95rem, 1.4vw, 1.15rem);
    line-height: 1.65;
    color: rgba(255, 255, 255, 0.72);
    white-space: pre-wrap;
  }
  .lyrics-note {
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.4);
    font-style: italic;
  }
  .credits {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    max-height: 26vh;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .credits::-webkit-scrollbar { display: none; }
  .credits-heading {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: rgba(255, 255, 255, 0.4);
    margin-bottom: 0.35rem;
  }
  .credit-row {
    display: flex;
    gap: 0.75rem;
    font-size: 0.85rem;
    line-height: 1.5;
    align-items: baseline;
  }
  .credit-label {
    flex: 0 0 9.5rem;
    color: rgba(255, 255, 255, 0.45);
    text-align: right;
    text-transform: lowercase;
  }
  .credit-people { min-width: 0; }
  .credit-sep { color: rgba(255, 255, 255, 0.3); margin: 0 0.35rem; }
  .credit-person {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
  }
  .credit-person:hover { color: #fff; text-decoration: underline; }

  @media (max-width: 860px) {
    .stage {
      grid-template-columns: 1fr;
      gap: 1.5rem;
      overflow-y: auto;
      align-items: start;
    }
    .cover { max-width: 46vh; }
  }
</style>
