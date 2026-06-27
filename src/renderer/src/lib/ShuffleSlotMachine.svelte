<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { PlexAlbum } from '../../../shared/plex'
  import { plexState } from './plex-state.svelte'
  import { queueMenuItems } from './queue-menu'

  type Phase = 'idle' | 'loading' | 'spinning' | 'landing' | 'landed' | 'error'

  const SPIN_VELOCITY = 2800 // px/sec leftward
  const LANDING_DURATION = 1000 // ms

  let phase = $state<Phase>('idle')
  let pool = $state<PlexAlbum[]>([])
  let strip = $state<PlexAlbum[]>([])
  let translateX = $state(0)
  let landedIndex = $state<number | null>(null)
  let viewportWidth = $state(800)
  // Card outer width = card width + horizontal margin (10px each side). Driven
  // by CSS clamp on .card so the slot machine never crops the cover when the
  // window is short. ResizeObserver mirrors it back to JS for landing math.
  let cardOuter = $state(580)
  let errorMsg = $state<string | null>(null)

  let viewportEl: HTMLDivElement | null = $state(null)
  let rafId: number | null = null
  let lastFrameMs: number | null = null
  let landingFrom = 0
  let landingTo = 0
  let landingStartedAt = 0
  let releaseHandler: ((e: PointerEvent) => void) | null = null
  let pendingRelease = false

  export async function start(): Promise<void> {
    if (phase !== 'idle' && phase !== 'landed' && phase !== 'error') return
    cleanup()
    landedIndex = null
    errorMsg = null
    pendingRelease = false
    // Attach the release listener BEFORE the async load so a tap that
    // releases during 'loading' isn't dropped.
    armRelease()
    phase = 'loading'
    try {
      const albums = await plexState.fetchRandomAlbums(60)
      if (albums.length === 0) {
        errorMsg = 'no albums match the current filters'
        phase = 'error'
        disarmRelease()
        return
      }
      pool = albums
      strip = Array.from({ length: 8 }, () => pool).flat()
      translateX = 0
      lastFrameMs = null
      phase = 'spinning'
      if (pendingRelease) {
        release()
        return
      }
      rafId = requestAnimationFrame(tick)
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err)
      phase = 'error'
      disarmRelease()
    }
  }

  function armRelease(): void {
    disarmRelease()
    releaseHandler = () => {
      if (phase === 'spinning') release()
      else if (phase === 'loading') pendingRelease = true
    }
    window.addEventListener('pointerup', releaseHandler)
  }

  function disarmRelease(): void {
    if (releaseHandler) {
      window.removeEventListener('pointerup', releaseHandler)
      releaseHandler = null
    }
  }

  function release(): void {
    if (phase !== 'spinning') return
    disarmRelease()
    landingFrom = translateX
    // Pick a target X that snaps a card center to the marker, after a few
    // extra cards' worth of glide so the deceleration feels like a slot.
    const landingExtra = cardOuter * 2
    const provisionalTarget = translateX - landingExtra
    const vw = viewportWidth
    const idealIndex = Math.round((vw / 2 - provisionalTarget - cardOuter / 2) / cardOuter)
    const finalIdx = Math.max(0, Math.min(strip.length - 1, idealIndex))
    landingTo = vw / 2 - (finalIdx * cardOuter + cardOuter / 2)
    landingStartedAt = performance.now()
    landedIndex = finalIdx
    phase = 'landing'
    if (rafId === null) rafId = requestAnimationFrame(tick)
  }

  function easeOutQuart(t: number): number {
    return 1 - Math.pow(1 - t, 4)
  }

  function tick(now: number): void {
    if (phase === 'spinning') {
      if (lastFrameMs != null) {
        const dt = (now - lastFrameMs) / 1000
        translateX -= SPIN_VELOCITY * dt
      }
      lastFrameMs = now
      rafId = requestAnimationFrame(tick)
    } else if (phase === 'landing') {
      const elapsed = now - landingStartedAt
      const t = Math.min(1, elapsed / LANDING_DURATION)
      translateX = landingFrom + (landingTo - landingFrom) * easeOutQuart(t)
      if (t >= 1) {
        translateX = landingTo
        phase = 'landed'
        rafId = null
        return
      }
      rafId = requestAnimationFrame(tick)
    } else {
      rafId = null
    }
  }

  function cleanup(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (wheelEndTimer !== null) {
      window.clearTimeout(wheelEndTimer)
      wheelEndTimer = null
    }
    lastFrameMs = null
    disarmRelease()
  }

  function close(): void {
    cleanup()
    phase = 'idle'
    pool = []
    strip = []
    translateX = 0
    landedIndex = null
    errorMsg = null
  }

  function pickLanded(): void {
    if (landedIndex === null) return
    const album = strip[landedIndex]
    if (!album) return
    void plexState.playback.requestCastAlbum(album.ratingKey, album.title, album.artist)
    close()
  }

  function openLandedDetail(): void {
    if (landedIndex === null) return
    const album = strip[landedIndex]
    if (!album) return
    plexState.openAlbumDetail(album.ratingKey)
    close()
  }

  function onCardContextMenu(e: MouseEvent, album: { ratingKey: string; title: string; artist: string }): void {
    e.preventDefault()
    plexState.openContextMenu(e.clientX, e.clientY, [
      {
        label: 'Play Now',
        onClick: () => {
          void plexState.playback.requestCastAlbum(album.ratingKey, album.title, album.artist)
          close()
        }
      },
      // Shared queue section, with the slot-machine overlay closed after any pick.
      ...queueMenuItems('album', album.ratingKey, album.title, album.artist).map((it) =>
        it.separator
          ? it
          : {
              ...it,
              onClick: () => {
                it.onClick()
                close()
              }
            }
      )
    ])
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (phase === 'idle') return
    if (e.key === 'Escape') close()
    if ((e.key === 'Enter' || e.key === ' ') && phase === 'landed') {
      e.preventDefault()
      pickLanded()
    }
  }

  // Two-finger trackpad / horizontal wheel scroll while landed shifts the
  // strip to the next or previous card. We keep `translateX` continuous so
  // the motion feels physical, then debounce-snap to the nearest card center
  // when scrolling stops so the marker always lines up with a real album.
  let wheelEndTimer: number | null = null
  function onWheel(e: WheelEvent): void {
    if (phase !== 'landed') return
    const delta = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    if (delta === 0) return
    e.preventDefault()
    translateX -= delta
    const vw = viewportWidth
    const idx = Math.round((vw / 2 - translateX - cardOuter / 2) / cardOuter)
    landedIndex = Math.max(0, Math.min(strip.length - 1, idx))
    if (wheelEndTimer !== null) window.clearTimeout(wheelEndTimer)
    wheelEndTimer = window.setTimeout(() => {
      if (landedIndex === null) return
      translateX = vw / 2 - (landedIndex * cardOuter + cardOuter / 2)
      wheelEndTimer = null
    }, 140)
  }

  function onResize(): void {
    syncMetrics()
  }

  // Read the CSS-driven card size (set by .machine via clamp) so the landing
  // math matches the actual rendered cards. Re-read on resize. We also write
  // the resolved pixel value back as `--slot-card-px` so the card uses an
  // explicit integer width AND height (guaranteeing square render — no flex
  // pressure, no aspect-ratio rounding surprises).
  function syncMetrics(): void {
    if (!viewportEl) return
    viewportWidth = viewportEl.clientWidth
    const raw = getComputedStyle(viewportEl).getPropertyValue('--slot-card').trim()
    const px = parseFloat(raw)
    if (Number.isFinite(px) && px > 0) {
      const rounded = Math.round(px)
      cardOuter = rounded + 20
      const machineEl = viewportEl.parentElement as HTMLElement | null
      if (machineEl) machineEl.style.setProperty('--slot-card-px', `${rounded}px`)
    }
  }

  $effect(() => {
    if (viewportEl) syncMetrics()
  })

  onDestroy(close)
</script>

<svelte:window onresize={onResize} onkeydown={onKeyDown} />

{#if phase !== 'idle'}
  <div class="overlay" role="dialog" aria-label="Shuffle slot machine">
    <button
      type="button"
      class="backdrop"
      aria-label="Close"
      onclick={close}
      tabindex="-1"
    ></button>
    <div class="machine">
      <div class="frame" bind:this={viewportEl} onwheel={onWheel}>
        {#if phase === 'loading'}
          <div class="hint">spinning up…</div>
        {:else if phase === 'error'}
          <div class="hint">{errorMsg ?? 'no albums to spin'}</div>
        {:else}
          <div class="strip" style="transform: translate3d({translateX}px, -50%, 0);">
            {#each strip as album, i (i)}
              {@const isLanded = landedIndex === i && phase === 'landed'}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <div
                class="card"
                class:landed={isLanded}
                class:clickable={isLanded}
                role={isLanded ? 'button' : undefined}
                tabindex={isLanded ? 0 : undefined}
                onclick={isLanded ? pickLanded : undefined}
                oncontextmenu={isLanded ? (e) => onCardContextMenu(e, album) : undefined}
                onkeydown={isLanded
                  ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickLanded() } }
                  : undefined}
                title={isLanded ? `Play ${album.title}` : undefined}
              >
                <div class="cover">
                  {#if album.thumb}
                    <img
                      src={plexState.thumbUrl(album.thumb, 800) ?? ''}
                      alt={album.title}
                      draggable="false"
                    />
                  {:else}
                    <div class="thumb-fallback">{album.title.slice(0, 1)}</div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
      <div class="caption">
        {#if phase === 'spinning'}
          <span class="hint-text">release to land</span>
        {:else if phase === 'landing'}
          <span class="hint-text">…</span>
        {:else if phase === 'landed' && landedIndex !== null && strip[landedIndex]}
          <button class="confirm" onclick={pickLanded}>
            <span class="confirm-artist">{strip[landedIndex].artist}</span>
            <span class="confirm-sep">—</span>
            <span class="confirm-title">{strip[landedIndex].title}</span>
          </button>
          <button
            class="reroll"
            onpointerdown={(e) => { e.preventDefault(); void start() }}
            title="Hold to re-roll"
            aria-label="Hold to re-roll"
          >
            <span class="dice-glyph" aria-hidden="true">⚄</span>
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
  }
  /* Now-playing bar sits 80px tall at the bottom of the viewport — centering
     the modal in the full viewport visually skews it under the bar. Add
     bottom padding so the modal's centered between the top edge and the bar. */
  :global(body.has-now-playing) .overlay {
    padding-bottom: 80px;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(43, 29, 18, 0.3);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 0;
    cursor: pointer;
    padding: 0;
  }
  .machine {
    /* `--slot-card` is the design intent (clamp). `syncMetrics()` resolves it
       to an integer pixel value and writes back `--slot-card-px`, which is
       what every box below actually consumes. Fallback to the clamp on the
       very first paint before JS has run. */
    --slot-card: clamp(180px, calc(100vh - 240px), 580px);
    --slot-card-px: var(--slot-card);
    position: relative;
    width: min(96vw, 1400px);
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1.2rem;
    align-items: center;
    pointer-events: none;
  }
  .machine > * { pointer-events: auto; }
  .frame {
    /* Frame is the horizontal viewport with the fade mask. Height is locked
       to card-px + vertical breathing room so it never collapses under flex
       pressure. */
    flex: 0 0 auto;
    position: relative;
    width: 100%;
    height: calc(var(--slot-card-px) + 40px);
    min-height: calc(var(--slot-card-px) + 40px);
    overflow: hidden;
    border-radius: var(--radius-2xl);
    background: var(--espresso);
    box-shadow: 0 30px 60px rgba(43, 29, 18, 0.45), inset 0 0 0 1px rgba(43, 29, 18, 0.6);
    -webkit-mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
    mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
  }
  .strip {
    /* `width: max-content` lets the flex row size to the sum of its children;
       since the row has no upper width bound, flex children can never be
       compressed. Explicit height gives the cross-axis a resolvable size.
       Vertical centering is folded into the inline `transform: translate3d`
       on the element — the inline style otherwise clobbers any CSS
       `transform` here, so we can't put `translateY(-50%)` here as well. */
    position: absolute;
    top: 50%;
    left: 0;
    width: max-content;
    height: var(--slot-card-px);
    display: flex;
    align-items: center;
    will-change: transform;
  }
  .card {
    /* Belt and braces: explicit width AND height AND min-width AND min-height
       AND flex:0 0 auto. No single rule is load-bearing; if any one fails
       (browser quirk, intrinsic image size, flex sizing pass) the others
       still pin the box to a square. */
    flex: 0 0 auto;
    width: var(--slot-card-px);
    height: var(--slot-card-px);
    min-width: var(--slot-card-px);
    min-height: var(--slot-card-px);
    margin: 0 10px;
    border-radius: var(--radius-xl);
    background: var(--surface);
    box-shadow: 0 16px 36px rgba(43, 29, 18, 0.28);
  }
  .cover {
    /* Parent .card is already a known-square pixel box; cover just fills it.
       Dropping aspect-ratio here because it can compete with the explicit
       100%/100% percentages and shrink one axis in some renderers. */
    display: block;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    overflow: hidden;
    background: var(--surface);
  }
  .cover img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    pointer-events: none;
  }
  .thumb-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--whisper);
    font-size: 3rem;
    font-weight: 700;
  }
  .card.landed {
    transform: scale(1.08);
    box-shadow: 0 0 0 2px var(--brick), 0 0 40px rgba(140, 53, 34, 0.55), 0 22px 48px rgba(43, 29, 18, 0.32);
    animation: land-bounce 600ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .card.clickable { cursor: pointer; }
  .card.clickable:focus-visible {
    outline: 2px solid var(--brick);
    outline-offset: 4px;
  }
  @keyframes land-bounce {
    0% { transform: scale(1); }
    55% { transform: scale(1.18); }
    100% { transform: scale(1.08); }
  }
  .caption {
    color: var(--walnut);
    font-size: 0.85rem;
    letter-spacing: 0.02em;
    min-height: 2.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  .reroll {
    background: transparent;
    color: var(--brick);
    border: 1px solid var(--hairline);
    width: 36px;
    height: 36px;
    border-radius: var(--radius-pill);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: border-color 120ms ease, background 120ms ease, transform 80ms ease;
  }
  .reroll:hover { border-color: var(--brick); background: var(--brick-wash); }
  .reroll:active { transform: scale(0.95); }
  .reroll .dice-glyph { font-size: 1.05rem; line-height: 1; }
  .hint-text {
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.18em;
    color: var(--faded);
  }
  .confirm {
    background: rgba(140, 53, 34, 0.18);
    color: var(--brick-deep);
    border: 1px solid rgba(140, 53, 34, 0.45);
    padding: 0.55rem 1.2rem;
    border-radius: var(--radius-pill);
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    max-width: min(80vw, 700px);
  }
  .confirm:hover { background: rgba(140, 53, 34, 0.28); }
  .confirm-artist { color: var(--espresso); }
  .confirm-sep { color: rgba(140, 53, 34, 0.6); }
  .confirm-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint { color: var(--faded); align-self: center; padding: 90px 1rem; font-size: 0.85rem; }
</style>
