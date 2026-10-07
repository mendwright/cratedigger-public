<script lang="ts">
  import { plexState } from './plex-state.svelte'
  import { isPiPlayerId } from './pi-target'
  import type { PiRadioStationId, RadioStar } from '../../../shared/plex'

  // Only meaningful when the living-room Pi is the active player — live
  // radio streams play through mpv there, not through Plex.
  const visible = $derived(isPiPlayerId(plexState.playback.activePlayerId))

  let open = $state(false)
  let rootEl: HTMLDivElement | undefined = $state()
  let stars = $state<RadioStar[]>([])
  let starsError = $state<string | null>(null)

  const STATIONS: { id: PiRadioStationId; name: string; meta: string }[] = [
    { id: 'kexp', name: 'KEXP', meta: 'Seattle · 160 kbps AAC' },
    { id: 'paradise', name: 'Radio Paradise', meta: 'Main mix · FLAC' },
    { id: 'sxm-xmu', name: 'SiriusXMU', meta: 'ch. 35 · via Mary’s SiriusXM' },
    { id: 'sxm-indie', name: 'Indie 1.0', meta: 'ch. 1227 · via Mary’s SiriusXM' }
  ]

  function toggle(): void {
    open = !open
    if (open) void loadStars()
  }

  async function loadStars(): Promise<void> {
    starsError = null
    try {
      stars = (await window.cratedigger.pi?.listRadioStars()) ?? []
    } catch (err) {
      starsError = err instanceof Error ? err.message : String(err)
    }
  }

  function pick(id: PiRadioStationId): void {
    open = false
    void plexState.playback.playPiRadio(id)
  }

  // A star Mary left on the kiosk → open a Soulseek search so the album can
  // be grabbed. Search by album when the station API knew it, else by song.
  // The star stays until dismissed, so nothing gets lost.
  function grabStar(star: RadioStar): void {
    open = false
    void plexState.findGapOnSlskd(
      star.artist || star.title,
      star.album || (star.artist ? star.title : '')
    )
  }

  async function dismissStar(star: RadioStar, e: MouseEvent): Promise<void> {
    e.stopPropagation()
    try {
      await window.cratedigger.pi?.dismissRadioStar(star.id)
      stars = stars.filter((s) => s.id !== star.id)
    } catch {
      // kiosk unreachable; leave the row
    }
  }

  function starAge(at: string): string {
    const days = Math.floor((Date.now() - Date.parse(at)) / 86_400_000)
    if (!Number.isFinite(days) || days < 0) return ''
    if (days === 0) return 'today'
    if (days === 1) return 'yesterday'
    return `${days}d ago`
  }

  function onDocClick(e: MouseEvent): void {
    if (!rootEl || !open) return
    if (!rootEl.contains(e.target as Node)) open = false
  }

  $effect(() => {
    if (open) {
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }
    return undefined
  })
</script>

{#if visible}
  <div class="radio" bind:this={rootEl}>
    <button class="trigger" onclick={toggle} aria-haspopup="listbox" aria-expanded={open}>
      <span class="wave">((·))</span>
      <span class="name">radio</span>
      {#if stars.length}<span class="star-count">★ {stars.length}</span>{/if}
    </button>
    {#if open}
      <div class="menu" role="listbox">
        <div class="menu-head"><span class="label">live radio</span></div>
        <ul>
          {#each STATIONS as s (s.id)}
            <li>
              <button class="item" onclick={() => pick(s.id)} role="option" aria-selected="false">
                <span class="item-name">{s.name}</span>
                <span class="item-meta">{s.meta}</span>
              </button>
            </li>
          {/each}
        </ul>
        <div class="menu-head stars-head"><span class="label">starred on the radio</span></div>
        {#if starsError}
          <div class="err">{starsError}</div>
        {:else if stars.length === 0}
          <div class="empty">nothing starred yet — the ★ lives on the kiosk during radio.</div>
        {:else}
          <ul class="stars">
            {#each stars as star (star.id)}
              <li>
                <button class="item star-item" onclick={() => grabStar(star)} title="Search on Soulseek">
                  <span class="item-name">{star.artist ? `${star.artist} — ${star.title}` : star.title}</span>
                  <span class="item-meta"
                    >{star.album ? `${star.album} · ` : ''}{star.station === 'kexp'
                      ? 'KEXP'
                      : star.station === 'paradise'
                        ? 'Radio Paradise'
                        : 'radio'} · {starAge(star.at)} · click to find on Soulseek</span
                  >
                </button>
                <button class="dismiss" onclick={(e) => dismissStar(star, e)} title="Dismiss">✕</button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .radio {
    position: relative;
    -webkit-app-region: no-drag;
  }
  .trigger {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--inset);
    color: var(--espresso);
    border: 1px solid var(--hairline);
    padding: 0.4rem 0.75rem;
    border-radius: var(--radius-pill);
    font-size: 0.82rem;
    cursor: pointer;
  }
  .trigger:hover { border-color: var(--hairline-strong); background: var(--surface); }
  .wave { font-size: 0.7rem; color: var(--faded); letter-spacing: -0.05em; }
  .star-count { font-size: 0.72rem; color: var(--brick-deep); }
  .menu {
    position: absolute;
    top: calc(100% + 0.4rem);
    right: 0;
    min-width: 280px;
    max-width: 360px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: 0.5rem;
    box-shadow: var(--shadow-lg);
    z-index: 20;
  }
  .menu-head { padding: 0.15rem 0.5rem 0.4rem; }
  .stars-head { margin-top: 0.5rem; border-top: 1px solid var(--hairline); padding-top: 0.55rem; }
  .label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--faded);
  }
  ul { list-style: none; padding: 0; margin: 0; }
  .stars { max-height: 260px; overflow-y: auto; }
  .stars li { display: flex; align-items: center; gap: 0.2rem; }
  .item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    padding: 0.5rem 0.6rem;
    border-radius: var(--radius-md);
    cursor: pointer;
    color: var(--espresso);
  }
  .item:hover { background: var(--ink-tint-04); }
  .item-name { font-size: 0.88rem; font-weight: 500; }
  .item-meta { font-size: 0.7rem; color: var(--faded); }
  .star-item { flex: 1; min-width: 0; }
  .star-item .item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .dismiss {
    background: transparent;
    border: 0;
    color: var(--faded);
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0.3rem 0.4rem;
    border-radius: var(--radius-md);
  }
  .dismiss:hover { color: var(--err-fg); background: var(--ink-tint-04); }
  .err { color: var(--err-fg); font-size: 0.8rem; padding: 0.5rem; }
  .empty { color: var(--walnut); font-size: 0.78rem; padding: 0.4rem 0.6rem 0.5rem; line-height: 1.4; }
</style>
