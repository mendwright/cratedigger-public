<script lang="ts">
  import { plexState } from './plex-state.svelte'

  const include = $derived(plexState.filterState.genreInclude)
  const exclude = $derived(plexState.filterState.genreExclude)
  const allAlbumsLoading = $derived(plexState.allAlbumsLoading)
  const gi = $derived(plexState.genreIndex)
  const giProgress = $derived(gi.progress)
  const giIndexed = $derived(gi.indexedCount)

  async function confirmClearGenres(): Promise<void> {
    const ok = window.confirm(
      'Clear the MusicBrainz genre index? The library goes back to Plex\u2019s own genre tags. Rebuilding takes a few hours.'
    )
    if (ok) await gi.clear()
  }

  const counts = $derived.by(() => {
    const source = plexState.allAlbums ?? plexState.albums
    const m = new Map<string, number>()
    for (const a of source) {
      // Same source as the crate rail — the two are one filter seen two ways,
      // so they must agree on what genres exist.
      for (const g of plexState.genreIndex.genresFor(a)) {
        if (!g) continue
        m.set(g, (m.get(g) ?? 0) + 1)
      }
    }
    return m
  })

  let query = $state('')

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const entries = [...counts.entries()]
    const matching = q
      ? entries.filter(([name]) => name.toLowerCase().includes(q))
      : entries
    return matching.sort((a, b) => {
      const aRank = include.has(a[0]) ? 2 : exclude.has(a[0]) ? 1 : 0
      const bRank = include.has(b[0]) ? 2 : exclude.has(b[0]) ? 1 : 0
      if (aRank !== bRank) return bRank - aRank
      if (a[1] !== b[1]) return b[1] - a[1]
      return a[0].localeCompare(b[0])
    })
  })

  const totalSelected = $derived(include.size + exclude.size)

  function close(): void {
    plexState.closeGenreFilter()
  }

  function onBackdropKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
  }
</script>

{#if plexState.genreFilterOpen}
  <div
    class="backdrop"
    role="button"
    tabindex="0"
    aria-label="Close genre filter"
    onclick={close}
    onkeydown={onBackdropKey}
  ></div>
  <aside class="panel" aria-label="Genre filter">
    <header>
      <h2>Genres</h2>
      <button class="x" onclick={close} aria-label="Close">✕</button>
    </header>

    <div class="status">
      {#if allAlbumsLoading && counts.size === 0}
        <div class="hint">loading library…</div>
      {:else}
        <div class="hint">
          {counts.size.toLocaleString()} genre{counts.size === 1 ? '' : 's'} across your library
          {#if gi.active}
            · {giIndexed.toLocaleString()} from MusicBrainz
          {/if}
        </div>
      {/if}
    </div>

    <div class="index">
      {#if giProgress.running}
        <div class="progress-line">
          <div class="bar">
            <div
              class="fill"
              style="width: {giProgress.total > 0 ? (giProgress.done / giProgress.total) * 100 : 0}%"
            ></div>
          </div>
          <div class="progress-text">
            indexing {giProgress.done.toLocaleString()} / {giProgress.total.toLocaleString()}{giProgress.current
              ? ` · ${giProgress.current}`
              : ''}
          </div>
        </div>
        <button class="secondary" onclick={() => void gi.stop()}>Stop</button>
      {:else if !gi.active}
        <div class="hint">
          Plex&rsquo;s genre tags are coarse and uneven. Build the index to file albums
          under MusicBrainz genres instead, falling back to Last.fm.
        </div>
        <button class="primary" onclick={() => void gi.start()}>Build genre index</button>
      {:else}
        <div class="row-actions">
          <button class="secondary" onclick={() => void gi.start()}>Index new albums</button>
          <button class="secondary" onclick={() => void gi.start({ rebuild: true })}>Rebuild</button>
          <button class="secondary danger" onclick={() => void confirmClearGenres()}>Clear</button>
        </div>
      {/if}
      {#if giProgress.error}
        <div class="err">last error: {giProgress.error}</div>
      {/if}
    </div>

    {#if counts.size > 0}
      <div class="search">
        <input
          type="search"
          placeholder="Filter genres…"
          value={query}
          oninput={(e) => (query = (e.currentTarget as HTMLInputElement).value)}
        />
        {#if totalSelected > 0}
          <button class="clear-sel" onclick={() => plexState.clearGenres()}>clear ({totalSelected})</button>
        {/if}
      </div>
      <div class="legend">click to cycle: include → exclude → off</div>

      <ul>
        {#each filtered as [name, count] (name)}
          {@const state = plexState.genreState(name)}
          <li>
            <button
              type="button"
              class="row"
              class:include={state === 'include'}
              class:exclude={state === 'exclude'}
              onclick={() => plexState.toggleGenre(name)}
              title={state === 'include' ? 'including — click to exclude' : state === 'exclude' ? 'excluding — click to clear' : 'click to include'}
            >
              <span class="glyph" aria-hidden="true">
                {state === 'include' ? '+' : state === 'exclude' ? '−' : ''}
              </span>
              <span class="name" title={name}>{name}</span>
              <span class="count">{count}</span>
            </button>
          </li>
        {/each}
        {#if filtered.length === 0}
          <li class="empty">no matches</li>
        {/if}
      </ul>
    {/if}
  </aside>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(var(--shadow-color), 0.28);
    z-index: 55;
    border: 0;
    padding: 0;
  }
  .panel {
    position: fixed;
    right: 12px;
    top: 72px;
    bottom: 100px;
    width: 380px;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    z-index: 60;
    animation: pop 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
    color: var(--espresso);
  }
  @keyframes pop {
    from { transform: translateY(10px) scale(0.98); opacity: 0; }
    to { transform: translateY(0) scale(1); opacity: 1; }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.7rem 0.9rem 0.5rem;
    border-bottom: 1px solid var(--hairline);
  }
  h2 {
    font-family: var(--font-display);
    font-size: 1rem; font-weight: 600; margin: 0; letter-spacing: 0.01em;
    color: var(--espresso);
  }
  .x {
    background: transparent;
    border: 0;
    color: var(--faded);
    font-size: 0.9rem;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }
  .x:hover { background: var(--ink-tint-08); color: var(--espresso); }
  .status {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--hairline);
  }
  .hint { font-size: 0.78rem; color: var(--walnut); line-height: 1.4; }
  /* Genre-index controls. Same treatment as the label index in
     LabelFilter.svelte — the two panels are siblings and should read alike.
     All colours go through tokens so every theme restyles them. */
  .index {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0 0.9rem 0.7rem;
    border-bottom: 1px solid var(--ink-tint-08);
  }
  .row-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .progress-line { display: flex; flex-direction: column; gap: 0.3rem; }
  .bar {
    height: 4px;
    background: var(--ink-tint-08);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: linear-gradient(90deg, var(--brick-deep), var(--brick));
    transition: width 200ms ease;
  }
  .progress-text {
    font-size: 0.72rem;
    color: var(--faded);
    font-variant-numeric: tabular-nums;
  }
  .err {
    font-size: 0.72rem;
    color: var(--warn-fg);
    padding: 0.3rem 0.45rem;
    background: var(--warn-bg);
    border-radius: var(--radius-md);
  }
  .primary, .secondary {
    background: var(--brick);
    color: var(--inset);
    border: 0;
    padding: 0.4rem 0.8rem;
    border-radius: var(--radius-md);
    font-size: 0.78rem;
    cursor: pointer;
    font-weight: 600;
  }
  .primary:hover { background: var(--brick-deep); }
  .secondary {
    background: var(--ink-tint-06);
    color: var(--espresso);
    font-weight: 500;
  }
  .secondary:hover { background: var(--ink-tint-12); }
  .secondary.danger { color: var(--warn-fg); }
  .secondary.danger:hover { background: var(--warn-bg); }
  .search {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.55rem 0.7rem;
    border-bottom: 1px solid var(--hairline);
  }
  .search input {
    flex: 1;
    background: var(--inset);
    border: 1px solid var(--hairline);
    color: var(--espresso);
    padding: 0.35rem 0.6rem;
    border-radius: var(--radius-md);
    font-size: 0.82rem;
    outline: none;
  }
  .search input:focus { border-color: var(--brick); }
  .clear-sel {
    background: transparent;
    color: var(--brick);
    border: 0;
    font-size: 0.72rem;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
  }
  .clear-sel:hover { background: var(--brick-wash); }
  ul {
    list-style: none;
    margin: 0;
    padding: 0.3rem 0.3rem 0.6rem;
    overflow-y: auto;
    flex: 1;
  }
  .legend {
    padding: 0.3rem 0.9rem;
    font-size: 0.7rem;
    color: var(--faded);
    border-bottom: 1px solid var(--hairline);
  }
  .row {
    display: grid;
    grid-template-columns: 14px 1fr auto;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem 0.55rem;
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: 0.82rem;
    width: 100%;
    background: transparent;
    border: 1px solid transparent;
    color: var(--walnut);
    text-align: left;
    font-family: inherit;
  }
  .row:hover { background: var(--ink-tint-04); color: var(--espresso); }
  .row.include {
    border-color: var(--ok-border);
    background: var(--ok-bg);
    color: var(--ok-fg);
  }
  .row.exclude {
    border-color: var(--warn-border);
    background: var(--warn-bg);
    color: var(--warn-fg);
  }
  .glyph {
    text-align: center;
    font-weight: 700;
    font-size: 0.95rem;
    line-height: 1;
    color: inherit;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    color: var(--faded);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }
  .row.include .count, .row.exclude .count { color: inherit; opacity: 0.7; }
  li.empty {
    padding: 1rem;
    text-align: center;
    color: var(--faded);
    font-size: 0.8rem;
  }
</style>
