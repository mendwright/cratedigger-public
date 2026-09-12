<script lang="ts">
  import { plexState } from './plex-state.svelte'

  const mm = $derived(plexState.manualMatch.current)

  let artistEl = $state<HTMLInputElement | null>(null)

  $effect(() => {
    if (mm && artistEl) {
      // focus the title field initially since artist is usually right
      queueMicrotask(() => artistEl?.focus())
    }
  })

  function onKey(e: KeyboardEvent): void {
    if (!mm) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      plexState.manualMatch.close()
    }
  }

  function onSubmit(e: Event): void {
    e.preventDefault()
    if (!mm) return
    void plexState.manualMatch.runSearch()
  }

  function summary(r: import('../../../shared/plex').MbReleaseCandidate): string {
    const bits: string[] = []
    if (r.date) bits.push(r.date.slice(0, 4))
    if (r.country) bits.push(r.country)
    if (r.status && r.status !== 'Official') bits.push(r.status)
    if (r.trackCount) bits.push(`${r.trackCount} track${r.trackCount === 1 ? '' : 's'}`)
    return bits.join(' · ')
  }
</script>

<svelte:window onkeydown={onKey} />

{#if mm}
  <div class="backdrop" onmousedown={(e) => { if (e.target === e.currentTarget) plexState.manualMatch.close() }} role="presentation">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Match on MusicBrainz">
      <header class="head">
        <div>
          <div class="label">match on musicbrainz</div>
          <h2>{mm.title}</h2>
          <div class="sub">{mm.artist}</div>
        </div>
        <button class="close" onclick={() => plexState.manualMatch.close()} aria-label="Close">×</button>
      </header>

      <form class="search" onsubmit={onSubmit}>
        <label>
          <span>artist</span>
          <input
            bind:this={artistEl}
            type="text"
            value={mm.query.artist}
            oninput={(e) => plexState.manualMatch.setQuery((e.currentTarget as HTMLInputElement).value, mm.query.title)}
          />
        </label>
        <label>
          <span>title</span>
          <input
            type="text"
            value={mm.query.title}
            oninput={(e) => plexState.manualMatch.setQuery(mm.query.artist, (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <button type="submit" class="search-btn" disabled={mm.loading}>
          {mm.loading ? 'searching…' : 'search'}
        </button>
      </form>

      <div class="results">
        {#if mm.error}
          <p class="err">{mm.error}</p>
        {:else if mm.loading && mm.candidates.length === 0}
          <p class="hint">searching musicbrainz…</p>
        {:else if !mm.loading && mm.candidates.length === 0}
          <p class="hint">no matches — try adjusting the search above.</p>
        {:else}
          <ul class="list">
            {#each mm.candidates as c (c.mbid)}
              <li>
                <button
                  class="result"
                  disabled={mm.submitting}
                  onclick={() => void plexState.manualMatch.confirm(c.mbid)}
                >
                  <div class="r-top">
                    <span class="r-title">{c.title}</span>
                    {#if c.disambiguation}
                      <span class="r-disambig">({c.disambiguation})</span>
                    {/if}
                  </div>
                  <div class="r-sub">
                    <span class="r-artist">{c.artistName || '—'}</span>
                    {#if summary(c)}<span class="r-dot">·</span><span>{summary(c)}</span>{/if}
                  </div>
                </button>
                <a
                  class="r-mb"
                  href={`https://musicbrainz.org/release/${c.mbid}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open on MusicBrainz"
                >↗</a>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(var(--shadow-color), 0.7);
    backdrop-filter: blur(4px);
    z-index: 150;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    animation: fade-in 140ms ease-out;
  }
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .modal {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-xl);
    width: min(640px, 100%);
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 64px rgba(var(--shadow-color), 0.28);
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
  h2 { font-size: 1.05rem; font-weight: 600; margin: 0.15rem 0 0.1rem; }
  .sub { color: var(--faded); font-size: 0.85rem; }
  .close {
    background: transparent;
    border: 0;
    color: var(--faded);
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 0.25rem;
  }
  .close:hover { color: var(--espresso); }

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
  .search input:focus { outline: none; border-color: var(--brick); }
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
  .search-btn:disabled { background: var(--hairline); color: var(--faded); cursor: default; }

  .results {
    overflow-y: auto;
    padding: 0.25rem 0.5rem 0.75rem;
    min-height: 100px;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
  }
  .list li {
    display: flex;
    gap: 0.25rem;
    align-items: stretch;
    padding: 0;
    border-radius: var(--radius-md);
  }
  .list li + li { margin-top: 0.15rem; }
  .result {
    flex: 1;
    text-align: left;
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    padding: 0.55rem 0.75rem;
    border-radius: var(--radius-md);
    font: inherit;
  }
  .result:hover:not(:disabled) { background: var(--hairline); }
  .result:disabled { opacity: 0.5; cursor: default; }
  .r-top { display: flex; gap: 0.4rem; align-items: baseline; }
  .r-title { font-size: 0.92rem; font-weight: 500; }
  .r-disambig { color: var(--faded); font-size: 0.8rem; }
  .r-sub { color: var(--faded); font-size: 0.8rem; margin-top: 0.15rem; }
  .r-dot { margin: 0 0.4rem; color: var(--whisper); }
  .r-mb {
    align-self: center;
    color: var(--faded);
    text-decoration: none;
    padding: 0 0.5rem;
    font-size: 0.85rem;
  }
  .r-mb:hover { color: var(--brick); }

  .hint { color: var(--faded); padding: 1rem 1.25rem; margin: 0; font-size: 0.85rem; }
  .err { color: var(--err-fg); padding: 1rem 1.25rem; margin: 0; font-size: 0.85rem; }
</style>
