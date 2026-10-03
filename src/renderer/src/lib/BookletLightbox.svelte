<script lang="ts">
  import type { BookletImage } from '../../../shared/plex'

  type Props = {
    images: BookletImage[]
    index: number
    onClose: () => void
    onIndex: (i: number) => void
  }

  const { images, index, onClose, onIndex }: Props = $props()

  const current = $derived(images[index] ?? null)

  function prev(): void {
    if (images.length === 0) return
    onIndex((index - 1 + images.length) % images.length)
  }
  function next(): void {
    if (images.length === 0) return
    onIndex((index + 1) % images.length)
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowLeft') prev()
    else if (e.key === 'ArrowRight') next()
  }
  function onBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) onClose()
  }
</script>

<svelte:window onkeydown={onKey} />

{#if current}
  <div
    class="backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="Booklet"
    tabindex={-1}
    onclick={onBackdrop}
    onkeydown={onKey}
  >
    <button class="close" onclick={onClose} aria-label="Close" title="Close (Esc)">×</button>

    {#if images.length > 1}
      <button class="nav prev" onclick={prev} aria-label="Previous (←)" title="Previous (←)">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>
      <button class="nav next" onclick={next} aria-label="Next (→)" title="Next (→)">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
    {/if}

    <figure>
      <img src={current.url} alt={current.types.join(', ')} />
      <figcaption>
        <span class="types">{current.types.join(' · ')}</span>
        {#if current.comment}<span class="comment">— {current.comment}</span>{/if}
        {#if images.length > 1}
          <span class="counter">{index + 1} / {images.length}</span>
        {/if}
      </figcaption>
    </figure>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.92);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3rem;
  }
  figure {
    margin: 0;
    max-width: min(95vw, 1400px);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }
  img {
    max-width: 100%;
    max-height: calc(90vh - 2.5rem);
    object-fit: contain;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
    border-radius: var(--radius-sm);
  }
  figcaption {
    color: rgba(255, 255, 255, 0.75);
    font-size: 0.85rem;
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    flex-wrap: wrap;
    justify-content: center;
  }
  .types { text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.72rem; }
  .comment { color: rgba(255, 255, 255, 0.6); font-style: italic; }
  .counter {
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.55);
  }
  button.close {
    position: absolute;
    top: 1rem;
    right: 1rem;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: rgba(255, 255, 255, 0.9);
    font-size: 1.4rem;
    line-height: 1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 120ms ease, transform 80ms ease;
  }
  button.close:hover { background: rgba(255, 255, 255, 0.18); }
  button.close:active { transform: scale(0.95); }
  button.nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 48px;
    height: 48px;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: rgba(255, 255, 255, 0.9);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 120ms ease;
  }
  button.nav:hover { background: rgba(255, 255, 255, 0.18); }
  button.nav.prev { left: 1.25rem; }
  button.nav.next { right: 1.25rem; }
</style>
