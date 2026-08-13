<script lang="ts">
  import { plexState } from './plex-state.svelte'

  const cp = $derived(plexState.coverArt.picker)
  const currentOverride = $derived(
    cp ? plexState.coverArt.overrides[cp.plexRatingKey] ?? null : null
  )

  let titleEl = $state<HTMLInputElement | null>(null)

  $effect(() => {
    if (cp && titleEl) {
      queueMicrotask(() => titleEl?.focus())
    }
  })

  function onKey(e: KeyboardEvent): void {
    if (!cp) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      plexState.coverArt.close()
    }
  }

  function onSubmit(e: Event): void {
    e.preventDefault()
    if (!cp) return
    void plexState.coverArt.runSearch()
  }

  function sourceLabel(s: 'itunes' | 'caa' | 'local'): string {
    if (s === 'itunes') return 'iTunes'
    if (s === 'local') return 'Uploaded'
    return 'CAA'
  }
</script>

<svelte:window onkeydown={onKey} />

{#if cp}
  <div
    class="backdrop"
    onmousedown={(e) => {
      if (e.target === e.currentTarget) plexState.coverArt.close()
    }}
    role="presentation"
  >
    <div class="modal" role="dialog" aria-modal="true" aria-label="Choose album cover">
      <header class="head">
        <div>
          <div class="label">choose cover</div>
          <h2>{cp.title}</h2>
          <div class="sub">{cp.artist}</div>
        </div>
        <button class="close" onclick={() => plexState.coverArt.close()} aria-label="Close">
          ×
        </button>
      </header>

      {#if currentOverride}
        <div class="current">
          <img src={currentOverride.thumbUrl} alt="current override" />
          <div class="current-info">
            <div class="current-label">current override</div>
            <div class="current-source">{sourceLabel(currentOverride.source)}</div>
          </div>
          <button
            class="reset-btn"
            onclick={() => void plexState.coverArt.clearForAlbum(cp.plexRatingKey)}
          >
            Reset to Plex cover
          </button>
        </div>
      {/if}

      <form class="search" onsubmit={onSubmit}>
        <label>
          <span>artist</span>
          <input
            type="text"
            value={cp.query.artist}
            oninput={(e) =>
              plexState.coverArt.setQuery(
                (e.currentTarget as HTMLInputElement).value,
                cp.query.title
              )}
          />
        </label>
        <label>
          <span>title</span>
          <input
            bind:this={titleEl}
            type="text"
            value={cp.query.title}
            oninput={(e) =>
              plexState.coverArt.setQuery(
                cp.query.artist,
                (e.currentTarget as HTMLInputElement).value
              )}
          />
        </label>
        <button type="submit" class="search-btn" disabled={cp.loading}>
          {cp.loading ? 'searching…' : 'search'}
        </button>
      </form>

      <div class="upload-row">
        <span class="upload-or">or</span>
        <button
          class="upload-btn"
          disabled={cp.submitting}
          onclick={() => void plexState.coverArt.uploadLocal()}
        >
          ⬆ upload from your computer
        </button>
      </div>

      <div class="results">
        {#if cp.error}
          <p class="err">{cp.error}</p>
        {:else if cp.loading && cp.candidates.length === 0}
          <p class="hint">searching iTunes &amp; Cover Art Archive…</p>
        {:else if !cp.loading && cp.candidates.length === 0}
          <p class="hint">no covers found — try adjusting the search above.</p>
        {:else}
          <div class="grid">
            {#each cp.candidates as c, i (`${c.source}:${i}:${c.url}`)}
              <button
                class="tile"
                disabled={cp.submitting}
                onclick={() => void plexState.coverArt.confirm(c)}
                title={c.label ?? sourceLabel(c.source)}
              >
                <img src={c.thumbUrl} alt={c.label ?? 'candidate'} loading="lazy" />
                <span class="src">{sourceLabel(c.source)}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(4, 4, 6, 0.7);
    backdrop-filter: blur(4px);
    z-index: 150;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    animation: fade-in 140ms ease-out;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .modal {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-xl);
    width: min(720px, 100%);
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 64px rgba(43, 29, 18, 0.28);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 1rem 1.25rem 0.5rem;
    border-bottom: 1px solid var(--hairline);
  }
  .label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--faded);
  }
  h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin: 0.15rem 0 0.1rem;
  }
  .sub {
    color: var(--faded);
    font-size: 0.85rem;
  }
  .close {
    background: transparent;
    border: 0;
    color: var(--faded);
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 0.25rem;
  }
  .close:hover {
    color: var(--espresso);
  }

  .current {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 1.25rem;
    border-bottom: 1px solid var(--hairline);
    background: var(--paper);
  }
  .current img {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-sm);
    object-fit: cover;
  }
  .current-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .current-label {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--faded);
  }
  .current-source {
    font-size: 0.85rem;
  }
  .reset-btn {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--espresso);
    border-radius: var(--radius-pill);
    padding: 0.3rem 0.7rem;
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .reset-btn:hover {
    border-color: var(--brick);
    color: var(--brick);
  }

  .search {
    display: grid;
    grid-template-columns: 1fr 2fr auto;
    gap: 0.5rem;
    padding: 0.85rem 1.25rem;
    border-bottom: 1px solid var(--hairline);
  }
  .search label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .search label span {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--faded);
  }
  .search input {
    background: var(--paper);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: 0.4rem 0.6rem;
    color: var(--espresso);
    font: inherit;
    font-size: 0.9rem;
    min-width: 0;
  }
  .search input:focus {
    outline: none;
    border-color: var(--brick);
  }
  .search-btn {
    align-self: end;
    background: var(--brick);
    color: var(--inset);
    border: 0;
    padding: 0.45rem 0.9rem;
    border-radius: var(--radius-pill);
    font-weight: 600;
    cursor: pointer;
  }
  .search-btn:disabled {
    background: var(--hairline);
    color: var(--faded);
    cursor: default;
  }

  .upload-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 1.25rem 0.75rem;
    border-bottom: 1px solid var(--hairline);
  }
  .upload-or {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--faded);
  }
  .upload-btn {
    background: transparent;
    border: 1px dashed var(--hairline);
    color: var(--espresso);
    border-radius: var(--radius-lg);
    padding: 0.45rem 0.85rem;
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
    transition: border-color 100ms ease-out, color 100ms ease-out;
  }
  .upload-btn:hover:not(:disabled) {
    border-color: var(--brick);
    color: var(--brick);
  }
  .upload-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .results {
    overflow-y: auto;
    padding: 0.75rem;
    min-height: 120px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.6rem;
  }
  .tile {
    position: relative;
    background: transparent;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: 0;
    cursor: pointer;
    overflow: hidden;
    aspect-ratio: 1;
    transition: border-color 100ms ease-out, transform 100ms ease-out;
  }
  .tile:hover:not(:disabled) {
    border-color: var(--brick);
    transform: translateY(-1px);
  }
  .tile:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .src {
    position: absolute;
    bottom: 4px;
    left: 4px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 1px 5px;
    border-radius: var(--radius-xs);
  }

  .hint {
    color: var(--faded);
    padding: 1rem 1.25rem;
    margin: 0;
    font-size: 0.85rem;
  }
  .err {
    color: var(--err-fg);
    padding: 1rem 1.25rem;
    margin: 0;
    font-size: 0.85rem;
  }
</style>
