<script lang="ts">
  import { plexState } from './plex-state.svelte'

  const labels = $derived(plexState.labelIndex.labels)
  const include = $derived(plexState.filterState.labelInclude)
  const exclude = $derived(plexState.filterState.labelExclude)
  const progress = $derived(plexState.labelIndex.progress)

  const aliases = $derived(plexState.labelAliases.aliases)

  // Count albums per label, folding by canonical name so merged aliases
  // collapse into one row. An album with both "New West Records" and
  // "New West Records LLC" in its raw array only counts once for the
  // canonical bucket.
  const counts = $derived.by(() => {
    // touch aliases so derived re-runs when the alias map changes
    void aliases
    const m = new Map<string, number>()
    for (const arr of Object.values(labels)) {
      const seen = new Set<string>()
      for (const name of arr) {
        const c = plexState.labelAliases.canonical(name)
        if (!c || seen.has(c)) continue
        seen.add(c)
        m.set(c, (m.get(c) ?? 0) + 1)
      }
    }
    return m
  })

  // Sorted alphabetically; used by the "merge into…" picker.
  const allCanonicalLabels = $derived(
    [...counts.keys()].sort((a, b) => a.localeCompare(b))
  )

  // Reverse index: canonical → variants that fold into it (excluding the
  // canonical itself). Drives the "merged from" hint on each row.
  const variantsByCanonical = $derived.by(() => {
    void aliases
    const m = new Map<string, string[]>()
    for (const [alias, canonical] of Object.entries(aliases)) {
      const arr = m.get(canonical) ?? []
      arr.push(alias)
      m.set(canonical, arr)
    }
    return m
  })

  // Merge-picker state: when set, we render a small popover with a search box
  // that lets the user pick the canonical name to fold this row into.
  let mergeFor = $state<string | null>(null)
  let mergeQuery = $state('')

  function openMerge(name: string): void {
    mergeFor = name
    mergeQuery = ''
  }
  function closeMerge(): void {
    mergeFor = null
    mergeQuery = ''
  }
  async function applyMerge(canonical: string): Promise<void> {
    const alias = mergeFor
    if (!alias) return
    closeMerge()
    await plexState.mergeLabel(alias, canonical)
  }
  function unmerge(alias: string): void {
    void plexState.unmergeLabel(alias)
  }

  const mergeOptions = $derived.by(() => {
    if (!mergeFor) return []
    const q = mergeQuery.trim().toLowerCase()
    return allCanonicalLabels
      .filter((n) => n !== mergeFor && (!q || n.toLowerCase().includes(q)))
      .slice(0, 50)
  })

  const totalIndexed = $derived(Object.keys(labels).length)
  const withLabels = $derived(
    Object.values(labels).filter((a) => a.length > 0).length
  )
  const emptyCount = $derived(totalIndexed - withLabels)

  let query = $state('')

  const totalSelected = $derived(include.size + exclude.size)

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase()
    const entries = [...counts.entries()]
    const matching = q
      ? entries.filter(([name]) => name.toLowerCase().includes(q))
      : entries
    return matching.sort((a, b) => {
      // Pin includes above excludes above neutral, then count desc, then alpha.
      const aRank = include.has(a[0]) ? 2 : exclude.has(a[0]) ? 1 : 0
      const bRank = include.has(b[0]) ? 2 : exclude.has(b[0]) ? 1 : 0
      if (aRank !== bRank) return bRank - aRank
      if (a[1] !== b[1]) return b[1] - a[1]
      return a[0].localeCompare(b[0])
    })
  })

  function close(): void {
    plexState.closeLabelFilter()
  }

  function onBackdropKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
  }

  const backupCount = $derived(plexState.labelIndex.backupCount)

  function confirmClear(): void {
    const n = totalIndexed.toLocaleString()
    const ok = window.confirm(
      `Clear the label index? This drops ${n} indexed entries. A backup is kept so you can restore it from this panel.`
    )
    if (ok) void plexState.labelIndex.clear()
  }
</script>

{#if plexState.labelFilterOpen}
  <div
    class="backdrop"
    role="button"
    tabindex="0"
    aria-label="Close label filter"
    onclick={close}
    onkeydown={onBackdropKey}
  ></div>
  <aside class="panel" aria-label="Label filter">
    <header>
      <h2>Labels</h2>
      <button class="x" onclick={close} aria-label="Close">✕</button>
    </header>

    <div class="status">
      {#if progress.running}
        <div class="progress-line">
          <div class="bar"><div class="fill" style="width: {progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%"></div></div>
          <div class="progress-text">
            indexing {progress.done} / {progress.total}{progress.current ? ` · ${progress.current}` : ''}
          </div>
        </div>
        <button class="secondary" onclick={() => void plexState.labelIndex.stop()}>Stop</button>
      {:else if totalIndexed === 0}
        <div class="hint">No labels indexed yet. MusicBrainz is rate-limited to 1 req/sec — a full library can take a while.</div>
        {#if backupCount > 0}
          <div class="hint">A backup of {backupCount.toLocaleString()} entries is available from a previous clear.</div>
          <div class="row">
            <button class="primary" onclick={() => void plexState.labelIndex.restoreBackup()}>Restore backup ({backupCount.toLocaleString()})</button>
            <button class="secondary" onclick={() => void plexState.labelIndex.start(false)}>Build from scratch</button>
          </div>
        {:else}
          <button class="primary" onclick={() => void plexState.labelIndex.start(false)}>Build label index</button>
        {/if}
      {:else}
        <div class="hint">
          {withLabels.toLocaleString()} albums with labels · {counts.size.toLocaleString()} unique labels ({totalIndexed.toLocaleString()} checked)
          {#if emptyCount > 0}
            · <span class="empty-stat">{emptyCount.toLocaleString()} with no label</span>
          {/if}
        </div>
        <div class="row">
          <button class="secondary" onclick={() => void plexState.labelIndex.start(false)}>Index new albums</button>
          {#if emptyCount > 0}
            <button
              class="secondary"
              onclick={() => void plexState.labelIndex.retryEmpty()}
              title="Re-run the indexer on albums that came back empty. MB data changes, so some may resolve now."
            >Retry no-label ({emptyCount.toLocaleString()})</button>
          {/if}
          <button class="secondary" onclick={() => void plexState.labelIndex.start(true)}>Rebuild</button>
          <button class="secondary danger" onclick={confirmClear}>Clear</button>
        </div>
        {#if backupCount > 0}
          <div class="hint">Backup available: {backupCount.toLocaleString()} entries from the last clear.</div>
        {/if}
      {/if}
      {#if progress.error}
        <div class="err">last error: {progress.error}</div>
      {/if}
    </div>

    {#if counts.size > 0}
      <div class="search">
        <input
          type="search"
          placeholder="Filter labels…"
          value={query}
          oninput={(e) => (query = (e.currentTarget as HTMLInputElement).value)}
        />
        {#if totalSelected > 0}
          <button class="clear-sel" onclick={() => plexState.clearLabelFilter()}>clear ({totalSelected})</button>
        {/if}
      </div>
      <div class="legend">click to cycle: include → exclude → off</div>

      <ul>
        {#each filtered as [name, count] (name)}
          {@const state = plexState.labelState(name)}
          {@const variants = variantsByCanonical.get(name) ?? []}
          <li>
            <button
              type="button"
              class="row"
              class:include={state === 'include'}
              class:exclude={state === 'exclude'}
              onclick={() => plexState.toggleLabel(name)}
              title={state === 'include' ? 'including — click to exclude' : state === 'exclude' ? 'excluding — click to clear' : 'click to include'}
            >
              <span class="glyph" aria-hidden="true">
                {state === 'include' ? '+' : state === 'exclude' ? '−' : ''}
              </span>
              <span class="name" title={variants.length > 0 ? `${name}\n(merged from: ${variants.join(', ')})` : name}>
                {name}
                {#if variants.length > 0}
                  <span class="variants" aria-label="merged variants">+{variants.length}</span>
                {/if}
              </span>
              <span class="count">{count}</span>
            </button>
            <button
              type="button"
              class="merge-btn"
              onclick={(e) => { e.stopPropagation(); openMerge(name) }}
              title={`Merge "${name}" into another label`}
              aria-label="Merge into…"
            >⋯</button>
          </li>
        {/each}
        {#if filtered.length === 0}
          <li class="empty">no matches</li>
        {/if}
      </ul>

      {#if mergeFor}
        <div
          class="merge-backdrop"
          role="button"
          tabindex="0"
          aria-label="Close merge picker"
          onclick={closeMerge}
          onkeydown={(e) => { if (e.key === 'Escape') closeMerge() }}
        ></div>
        <div class="merge-popover" role="dialog" aria-label="Merge label into">
          <div class="merge-head">
            <div class="merge-title">
              merge <strong>{mergeFor}</strong> into…
            </div>
            <button class="x" onclick={closeMerge} aria-label="Close">✕</button>
          </div>
          {#if (variantsByCanonical.get(mergeFor) ?? []).length > 0}
            <div class="merge-existing">
              <div class="merge-existing-label">already merged here:</div>
              <ul>
                {#each variantsByCanonical.get(mergeFor) ?? [] as v (v)}
                  <li>
                    <span class="variant-name">{v}</span>
                    <button class="unmerge" onclick={() => unmerge(v)} title={`Stop merging "${v}" into "${mergeFor}"`}>unmerge</button>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
          {#if aliases[mergeFor]}
            <div class="hint">
              currently folds into <strong>{aliases[mergeFor]}</strong> ·
              <button class="unmerge" onclick={() => { const a = mergeFor; closeMerge(); if (a) void plexState.unmergeLabel(a) }}>unmerge</button>
            </div>
          {/if}
          <input
            type="search"
            placeholder="search labels…"
            value={mergeQuery}
            oninput={(e) => (mergeQuery = (e.currentTarget as HTMLInputElement).value)}
            {@attach (node: HTMLInputElement) => node.focus()}
          />
          <ul class="merge-options">
            {#each mergeOptions as opt (opt)}
              <li>
                <button onclick={() => void applyMerge(opt)}>{opt}</button>
              </li>
            {/each}
            {#if mergeOptions.length === 0}
              <li class="empty">no matches</li>
            {/if}
          </ul>
        </div>
      {/if}
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
  .empty-stat { color: var(--brick); }
  .err {
    font-size: 0.72rem;
    color: var(--warn-fg);
    padding: 0.3rem 0.45rem;
    background: var(--warn-bg);
    border-radius: var(--radius-md);
  }
  .row { display: flex; gap: 0.4rem; flex-wrap: wrap; }
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
  ul li {
    display: flex;
    align-items: stretch;
    gap: 0.15rem;
  }
  ul li .row { flex: 1; min-width: 0; }
  .merge-btn {
    background: transparent;
    border: 1px solid transparent;
    color: var(--faded);
    font-size: 0.95rem;
    cursor: pointer;
    width: 1.8rem;
    border-radius: var(--radius-md);
    padding: 0;
    line-height: 1;
    opacity: 0;
    transition: opacity 100ms ease, background 100ms ease, color 100ms ease;
  }
  ul li:hover .merge-btn { opacity: 1; }
  .merge-btn:hover { background: var(--ink-tint-08); color: var(--espresso); }
  .variants {
    margin-left: 0.35rem;
    font-size: 0.62rem;
    padding: 0.05rem 0.3rem;
    border-radius: var(--radius-pill);
    background: var(--ink-tint-08);
    color: var(--faded);
    vertical-align: 1px;
  }
  /* A recess in whichever state fill the row is wearing. currentColor is
     --ok-fg on an include row and --err-fg on an exclude row, so one rule
     covers both and follows the theme; the literal white it replaced was
     invisible on the light themes. */
  .row.include .variants, .row.exclude .variants {
    background: color-mix(in srgb, currentColor 18%, transparent);
    color: inherit;
  }

  .merge-backdrop {
    position: fixed;
    inset: 0;
    background: var(--ink-tint-16);
    z-index: 65;
    border: 0;
    padding: 0;
  }
  .merge-popover {
    position: fixed;
    right: 24px;
    top: 100px;
    width: 360px;
    max-height: calc(100vh - 200px);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    z-index: 70;
    padding: 0.7rem 0.8rem;
    gap: 0.5rem;
    color: var(--espresso);
  }
  .merge-head { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  .merge-title { font-size: 0.85rem; color: var(--walnut); }
  .merge-title strong { color: var(--espresso); }
  .merge-popover input[type='search'] {
    background: var(--inset);
    border: 1px solid var(--hairline);
    color: var(--espresso);
    padding: 0.35rem 0.6rem;
    border-radius: var(--radius-md);
    font-size: 0.82rem;
    outline: none;
  }
  .merge-popover input[type='search']:focus { border-color: var(--brick); }
  .merge-existing {
    background: var(--ink-tint-04);
    border-radius: var(--radius-md);
    padding: 0.4rem 0.55rem;
    font-size: 0.78rem;
  }
  .merge-existing-label { color: var(--faded); margin-bottom: 0.25rem; }
  .merge-existing ul { padding: 0; max-height: 100px; }
  .merge-existing li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    padding: 0.1rem 0;
  }
  .variant-name { color: var(--walnut); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .unmerge {
    background: transparent;
    border: 0;
    color: var(--brick);
    cursor: pointer;
    font-size: 0.72rem;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
  }
  .unmerge:hover { background: var(--brick-wash); }
  .merge-options { padding: 0.1rem; flex: 1; overflow-y: auto; }
  .merge-options li { padding: 0; }
  .merge-options li button {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    color: var(--espresso);
    padding: 0.35rem 0.55rem;
    border-radius: var(--radius-md);
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .merge-options li button:hover { background: var(--ink-tint-08); }
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
