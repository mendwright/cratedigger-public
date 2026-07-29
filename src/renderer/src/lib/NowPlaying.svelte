<script lang="ts">
  import { plexState } from './plex-state.svelte'

  const tl = $derived(plexState.playback.timeline)
  const staged = $derived(plexState.playback.radio.staged)
  const playerName = $derived(plexState.playback.activePlayerName() ?? '')
  const thumbSrc = $derived(plexState.thumbUrl(tl?.thumb ?? null, 120))

  // Local smooth clock: Plex's session viewOffset only refreshes every ~10s, so
  // we anchor on the server value and tick locally between polls.
  let tickNow = $state(performance.now())
  let baseTime = 0
  let baseAt = 0
  let baseRatingKey: string | null = null

  $effect(() => {
    if (!tl) {
      baseRatingKey = null
      return
    }
    // Re-anchor whenever server sends a new time OR the track changes. We
    // detect server updates by watching tl.time + ratingKey together: a
    // different track means reset, a moved time means resync.
    const next = tl.time
    if (tl.ratingKey !== baseRatingKey) {
      baseRatingKey = tl.ratingKey
      baseTime = next
      baseAt = performance.now()
      return
    }
    // For same track, only re-anchor when the server value disagrees with our
    // local projection by more than ~1.5s (corrects drift without jumping on
    // every 2.5s poll that happens to carry a stale viewOffset).
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

  // Drag-to-seek state
  let dragging = $state(false)
  let dragTime = $state(0)
  let railEl = $state<HTMLDivElement | null>(null)

  const liveTime = $derived.by(() => {
    if (!tl) return 0
    if (dragging) return dragTime
    if (tl.state !== 'playing') return baseTime
    // Reference tickNow so this derived re-runs on each tick.
    const elapsed = tickNow - baseAt
    return Math.min(tl.duration || Infinity, baseTime + elapsed)
  })
  const progress = $derived(tl && tl.duration > 0 ? Math.min(1, liveTime / tl.duration) : 0)

  function timeAtClientX(clientX: number): number {
    if (!railEl || !tl || !tl.duration) return 0
    const rect = railEl.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return ratio * tl.duration
  }

  function onRailPointerDown(e: PointerEvent): void {
    if (!tl || !tl.duration) return
    railEl?.setPointerCapture(e.pointerId)
    dragging = true
    dragTime = timeAtClientX(e.clientX)
    e.preventDefault()
  }

  function onRailPointerMove(e: PointerEvent): void {
    if (!dragging) return
    dragTime = timeAtClientX(e.clientX)
  }

  function onRailPointerUp(e: PointerEvent): void {
    if (!dragging) return
    const target = dragTime
    dragging = false
    try {
      railEl?.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    // Optimistically advance the local clock so the bar doesn't snap back
    // while we wait for Plex to reflect the seek.
    baseTime = target
    baseAt = performance.now()
    void plexState.playback.transport('seek', Math.round(target))
  }

  function fmt(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000))
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  function openAlbum(): void {
    if (plexState.nowPlayingOpen) plexState.closeNowPlaying()
    else if (tl) plexState.openNowPlaying()
  }
</script>

{#if tl}
  <div class="bar" class:paused={tl.state === 'paused'} class:theater={plexState.theaterOpen}>
    <button
      class="left"
      onclick={openAlbum}
      title="Open now playing"
    >
      {#if thumbSrc}
        <img src={thumbSrc} alt="" />
      {:else}
        <div class="ph"></div>
      {/if}
      <div class="meta">
        <div class="title" title={tl.title || undefined}>{tl.title || '—'}</div>
        <div class="sub" title={tl.album ? `${tl.artist} · ${tl.album}` : tl.artist}>
          {tl.artist}{tl.album ? ` · ${tl.album}` : ''}
        </div>
      </div>
    </button>

    <div class="center">
      <div class="controls">
        <button class="ctrl" onclick={() => void plexState.playback.transport('prev')} title="Previous" aria-label="Previous">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="19 20 9 12 19 4 19 20" fill="currentColor" stroke="none"></polygon>
            <line x1="5" y1="19" x2="5" y2="5"></line>
          </svg>
        </button>
        {#if tl.state === 'playing' || tl.state === 'buffering'}
          <button class="play" onclick={() => void plexState.playback.transport('pause')} title="Pause" aria-label="Pause">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none" aria-hidden="true">
              <rect x="6" y="4" width="4" height="16" rx="1"></rect>
              <rect x="14" y="4" width="4" height="16" rx="1"></rect>
            </svg>
          </button>
        {:else}
          <button class="play" onclick={() => void plexState.playback.transport('play')} title="Play" aria-label="Play">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="none" aria-hidden="true">
              <polygon points="6 4 21 12 6 20 6 4"></polygon>
            </svg>
          </button>
        {/if}
        <button class="ctrl" onclick={() => void plexState.playback.transport('next')} title="Next" aria-label="Next">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none"></polygon>
            <line x1="19" y1="5" x2="19" y2="19"></line>
          </svg>
        </button>
        <button
          class="queue-btn"
          class:active={plexState.playback.queueOpen}
          onclick={() => plexState.playback.toggleQueue()}
          title="Queue"
          aria-label="Queue"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="3" y1="6" x2="16" y2="6"></line>
            <line x1="3" y1="12" x2="16" y2="12"></line>
            <line x1="3" y1="18" x2="12" y2="18"></line>
            <polygon points="19 15 22 17 19 19 19 15" fill="currentColor" stroke="none"></polygon>
          </svg>
        </button>
        <button
          class="queue-btn"
          class:active={plexState.theaterOpen}
          onclick={() => (plexState.theaterOpen ? plexState.closeTheater() : plexState.openTheater())}
          title="Theater mode (⌘T)"
          aria-label="Theater mode"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="15 3 21 3 21 9"></polyline>
            <polyline points="9 21 3 21 3 15"></polyline>
            <line x1="21" y1="3" x2="14" y2="10"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
          </svg>
        </button>
        <button
          class="queue-btn"
          class:active={plexState.miniOpen}
          onclick={() => void window.cratedigger.mini.toggle()}
          title="Mini player (⌘⇧M)"
          aria-label="Mini player"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2"></rect>
            <rect x="12" y="12" width="7" height="5" rx="1" fill="currentColor" stroke="none"></rect>
          </svg>
        </button>
      </div>
      <div class="progress">
        <span class="t">{fmt(liveTime)}</span>
        <div
          class="bar-rail"
          class:dragging
          bind:this={railEl}
          onpointerdown={onRailPointerDown}
          onpointermove={onRailPointerMove}
          onpointerup={onRailPointerUp}
          onpointercancel={onRailPointerUp}
          role="slider"
          tabindex="0"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={tl.duration}
          aria-valuenow={Math.round(liveTime)}
        >
          <div class="bar-fill" style="width: {progress * 100}%"></div>
          <div class="bar-thumb" style="left: {progress * 100}%"></div>
        </div>
        <span class="t">{fmt(tl.duration)}</span>
      </div>
    </div>

    <div class="right">
      <div class="volume" title="Volume">
        <svg class="vol-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          {#if plexState.playback.volume === 0}
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"></polygon>
            <line x1="22" y1="9" x2="16" y2="15"></line>
            <line x1="16" y1="9" x2="22" y2="15"></line>
          {:else if plexState.playback.volume < 50}
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          {:else}
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          {/if}
        </svg>
        <input
          class="vol-slider"
          type="range"
          min="0"
          max="100"
          step="1"
          value={plexState.playback.volume}
          aria-label="Volume"
          oninput={(e) => plexState.playback.setVolume(Number((e.currentTarget as HTMLInputElement).value))}
        />
      </div>
      {#if staged}
        <button
          class="upnext"
          onclick={() => plexState.playback.toggleQueue()}
          title="Radio pick — open the queue to swap or remove it"
        >
          Up next: {staged.artist} — {staged.title}
        </button>
      {:else}
        <div class="on">on {playerName}</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    display: grid;
    grid-template-columns: minmax(220px, 1fr) minmax(340px, 1.3fr) minmax(160px, 1fr);
    gap: 1rem;
    align-items: center;
    padding: 0.7rem 1.1rem;
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    backdrop-filter: blur(24px) saturate(1.4);
    -webkit-backdrop-filter: blur(24px) saturate(1.4);
    border-top: 1px solid var(--hairline-strong);
    box-shadow: 0 -8px 24px var(--ink-tint-08);
    z-index: 50;
    animation: slide-up 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
    -webkit-app-region: drag;
  }
  .left, .ctrl, .play, .vol-slider, .volume, .progress, .queue-btn { -webkit-app-region: no-drag; }
  .bar.paused { filter: saturate(0.6); }
  /* Theater mode: dissolve into the dark backdrop instead of floating as a
     cream strip. Everything below styles itself off these vars, so one remap
     flips the whole bar. Theater base color is #0c0b0d (TheaterMode.svelte);
     kept translucent so the blurred cover art bleeds through the bar too. */
  .bar.theater {
    --surface: #0c0b0d;
    --espresso: rgba(255, 255, 255, 0.88);
    --paper: #0c0b0d;
    --faded: rgba(255, 255, 255, 0.52);
    --hairline: rgba(255, 255, 255, 0.12);
    --hairline-strong: rgba(255, 255, 255, 0.16);
    --ink-tint-04: rgba(255, 255, 255, 0.04);
    --ink-tint-08: rgba(255, 255, 255, 0.08);
    --ink-tint-12: rgba(255, 255, 255, 0.14);
    --ink-tint-16: rgba(255, 255, 255, 0.18);
    background: rgba(12, 11, 13, 0.4);
    border-top-color: transparent;
    box-shadow: none;
    color: var(--espresso);
  }
  @keyframes slide-up {
    from { transform: translateY(100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  .left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
    background: transparent;
    border: 0;
    padding: 0.2rem 0.35rem;
    border-radius: var(--radius-lg);
    color: inherit;
    text-align: left;
    font: inherit;
    cursor: pointer;
    transition: background 120ms ease;
  }
  .left:disabled { cursor: default; }
  .left:not(:disabled):hover { background: var(--hairline); }
  .left:focus-visible { outline: 2px solid var(--brick); outline-offset: 2px; }
  .left img, .ph {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-sm);
    object-fit: cover;
    background: var(--surface);
    flex-shrink: 0;
    box-shadow: 0 4px 14px rgba(43, 29, 18, 0.22), 0 0 0 1px var(--ink-tint-04);
  }
  .meta { min-width: 0; }
  .title {
    font-size: 0.9rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 0.78rem;
    color: var(--faded);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .center { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; width: 100%; }
  .controls { display: flex; align-items: center; gap: 0.75rem; }
  .ctrl, .play {
    background: transparent;
    border: 0;
    color: var(--espresso);
    cursor: pointer;
    font-size: 1.1rem;
    padding: 0.2rem 0.4rem;
    border-radius: var(--radius-md);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .ctrl:hover, .play:hover { background: var(--hairline); }
  .play {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-pill);
    background: var(--espresso);
    color: var(--paper);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 14px var(--ink-tint-12);
    transition: transform 120ms ease, box-shadow 140ms ease, background 120ms ease;
  }
  .play:hover { background: var(--brick); color: var(--paper); transform: scale(1.06); box-shadow: 0 6px 18px var(--ink-tint-16); }
  .play:active { transform: scale(0.97); }
  .progress {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    max-width: 420px;
    font-variant-numeric: tabular-nums;
    color: var(--faded);
    font-size: 0.72rem;
  }
  .bar-rail {
    position: relative;
    flex: 1;
    height: 14px;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
  }
  .bar-rail::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--ink-tint-12);
    border-radius: var(--radius-pill);
  }
  .bar-fill {
    position: relative;
    height: 3px;
    background: linear-gradient(90deg, var(--brick) 0%, var(--brick-deep) 100%);
    border-radius: var(--radius-pill);
    box-shadow: 0 0 8px rgba(140, 53, 34, 0.5);
    transition: width 260ms linear;
    pointer-events: none;
    overflow: hidden;
  }
  /* Inner top highlight — gives the fill a lacquered / wet-paint feel
     instead of the flat clay slab it was. Two-tone instead of one. */
  .bar-fill::after {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 1px;
    background: rgba(255, 255, 255, 0.38);
    border-radius: var(--radius-pill);
    pointer-events: none;
  }
  .bar-rail.dragging .bar-fill { transition: none; }
  .bar-thumb {
    position: absolute;
    top: 50%;
    width: 11px;
    height: 11px;
    margin-left: -5.5px;
    margin-top: -5.5px;
    border-radius: var(--radius-pill);
    background: #fff;
    box-shadow: 0 0 0 1px rgba(43, 29, 18, 0.18), 0 2px 6px rgba(43, 29, 18, 0.22);
    opacity: 0;
    transition: opacity 120ms ease, width 120ms ease, height 120ms ease, margin 120ms ease, left 260ms linear;
    pointer-events: none;
  }
  .bar-rail:hover .bar-thumb,
  .bar-rail.dragging .bar-thumb { opacity: 1; }
  .bar-rail.dragging .bar-thumb {
    width: 13px;
    height: 13px;
    margin-left: -6.5px;
    margin-top: -6.5px;
    transition: opacity 120ms ease, width 120ms ease, height 120ms ease, margin 120ms ease;
  }
  /* One row: volume slider then "on {player}" inline. Two rows of right-side
     content always read as misaligned next to the centered transport — one
     row reads as a single utility. */
  .right {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
  }
  .queue-btn {
    background: transparent;
    border: 0;
    color: var(--espresso);
    cursor: pointer;
    padding: 5px 7px;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .queue-btn:hover { background: var(--hairline); }
  .queue-btn.active { color: var(--brick); background: rgba(140, 53, 34, 0.15); }
  .queue-btn:focus-visible { outline: 2px solid var(--brick); outline-offset: 2px; }
  .volume {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    max-width: 160px;
  }
  .vol-icon {
    color: var(--faded);
    flex-shrink: 0;
  }
  .vol-slider {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    height: 4px;
    background: var(--hairline);
    border-radius: var(--radius-pill);
    cursor: ew-resize;
    outline: none;
  }
  .vol-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: var(--radius-pill);
    background: var(--brick);
    cursor: ew-resize;
    border: 0;
  }
  .vol-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: var(--radius-pill);
    background: var(--brick);
    cursor: ew-resize;
    border: 0;
  }
  .vol-slider:focus-visible { outline: 2px solid var(--brick); outline-offset: 3px; }
  .on {
    color: var(--faded);
    font-size: 0.75rem;
    /* At the 960px minimum the player name would wrap to a second line and
       fatten the whole bar — ellipsize instead. */
    max-width: 180px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .upnext {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--faded);
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
    text-align: right;
    max-width: 220px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .upnext:hover { color: var(--brick); }
</style>
