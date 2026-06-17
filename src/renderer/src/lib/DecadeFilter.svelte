<script lang="ts">
  import { plexState } from './plex-state.svelte'

  const selectedDecade = $derived(plexState.filterState.selectedDecade)
  const selectedYear = $derived(plexState.filterState.selectedYear)

  const yearCounts = $derived.by(() => {
    const source = plexState.allAlbums ?? plexState.albums
    const m = new Map<number, number>()
    for (const a of source) {
      if (a.year == null || a.year < 1900) continue
      m.set(a.year, (m.get(a.year) ?? 0) + 1)
    }
    return m
  })

  const decadeGroups = $derived.by(() => {
    const byDecade = new Map<number, { years: { year: number; count: number }[]; total: number }>()
    for (const [year, count] of yearCounts) {
      const d = Math.floor(year / 10) * 10
      let g = byDecade.get(d)
      if (!g) {
        g = { years: [], total: 0 }
        byDecade.set(d, g)
      }
      g.years.push({ year, count })
      g.total += count
    }
    const out = [...byDecade.entries()].map(([decade, g]) => ({
      decade,
      total: g.total,
      years: g.years.sort((a, b) => b.year - a.year)
    }))
    out.sort((a, b) => b.decade - a.decade)
    return out
  })

  // Auto-expand: the decade containing the selected year, or the selected decade itself.
  let expanded = $state<Set<number>>(new Set())

  $effect(() => {
    if (selectedYear != null) {
      const d = Math.floor(selectedYear / 10) * 10
      if (!expanded.has(d)) {
        const next = new Set(expanded)
        next.add(d)
        expanded = next
      }
    } else if (selectedDecade != null) {
      if (!expanded.has(selectedDecade)) {
        const next = new Set(expanded)
        next.add(selectedDecade)
        expanded = next
      }
    }
  })

  function toggleExpand(d: number): void {
    const next = new Set(expanded)
    if (next.has(d)) next.delete(d)
    else next.add(d)
    expanded = next
  }

  function pickDecade(d: number): void {
    plexState.setDecade(selectedDecade === d ? null : d)
  }

  function pickYear(y: number): void {
    plexState.setYear(selectedYear === y ? null : y)
  }

  function close(): void {
    plexState.closeDecadeFilter()
  }

  function onBackdropKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
  }

  function clearPick(): void {
    if (selectedYear != null) plexState.setYear(null)
    else if (selectedDecade != null) plexState.setDecade(null)
  }

  const hasPick = $derived(selectedDecade != null || selectedYear != null)
  const pickLabel = $derived(
    selectedYear != null ? `${selectedYear}` : selectedDecade != null ? `${selectedDecade}s` : ''
  )
</script>

{#if plexState.decadeFilterOpen}
  <div
    class="backdrop"
    role="button"
    tabindex="0"
    aria-label="Close decade filter"
    onclick={close}
    onkeydown={onBackdropKey}
  ></div>
  <aside class="panel" aria-label="Year and decade filter">
    <header>
      <h2>Year</h2>
      <button class="x" onclick={close} aria-label="Close">✕</button>
    </header>

    {#if decadeGroups.length === 0}
      <div class="status">
        <div class="hint">no year data yet — loading library…</div>
      </div>
    {:else}
      <div class="status">
        <div class="hint">pick a decade — or expand to pick a year</div>
        {#if hasPick}
          <button class="clear-sel" onclick={clearPick}>clear ({pickLabel})</button>
        {/if}
      </div>
      <ul class="groups">
        {#each decadeGroups as g (g.decade)}
          <li class="group">
            <div class="decade-row">
              <button
                class="decade"
                class:active={selectedDecade === g.decade}
                onclick={() => pickDecade(g.decade)}
                title={selectedDecade === g.decade ? 'Clear decade' : `Pick ${g.decade}s`}
              >
                <span class="name">{g.decade}s</span>
                <span class="count">{g.total}</span>
              </button>
              <button
                class="expand"
                class:open={expanded.has(g.decade)}
                onclick={() => toggleExpand(g.decade)}
                aria-label={expanded.has(g.decade) ? 'Collapse years' : 'Expand years'}
                title={expanded.has(g.decade) ? 'Hide years' : 'Show years'}
              >
                ›
              </button>
            </div>
            {#if expanded.has(g.decade)}
              <ul class="years">
                {#each g.years as y (y.year)}
                  <li>
                    <button
                      class="year"
                      class:active={selectedYear === y.year}
                      onclick={() => pickYear(y.year)}
                    >
                      <span class="name">{y.year}</span>
                      <span class="count">{y.count}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(43, 29, 18, 0.28);
    z-index: 55;
    border: 0;
    padding: 0;
  }
  .panel {
    position: fixed;
    right: 12px;
    top: 72px;
    bottom: 100px;
    width: 320px;
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
    align-items: center;
    justify-content: space-between;
    gap: 0.55rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--hairline);
  }
  .hint { font-size: 0.78rem; color: var(--walnut); line-height: 1.4; }
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
  ul.groups {
    list-style: none;
    margin: 0;
    padding: 0.3rem;
    overflow-y: auto;
    flex: 1;
  }
  li.group { margin: 0; }
  .decade-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 0.25rem;
  }
  .decade {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.45rem 0.7rem;
    border-radius: var(--radius-md);
    background: transparent;
    border: 0;
    color: var(--espresso);
    font-size: 0.88rem;
    cursor: pointer;
    text-align: left;
    font: inherit;
  }
  .decade:hover { background: var(--ink-tint-04); }
  .decade.active {
    background: var(--brick-wash);
    color: var(--brick-deep);
  }
  .expand {
    background: transparent;
    border: 0;
    color: var(--faded);
    cursor: pointer;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-md);
    font-size: 1.1rem;
    line-height: 1;
    transform: rotate(0deg);
    transition: transform 120ms ease, color 120ms ease, background 120ms ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .expand:hover { color: var(--espresso); background: var(--ink-tint-06); }
  .expand.open { transform: rotate(90deg); color: var(--espresso); }
  ul.years {
    list-style: none;
    margin: 0 0 0.25rem 1.25rem;
    padding: 0.2rem 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.15rem;
    border-left: 1px solid var(--hairline);
    padding-left: 0.5rem;
  }
  .year {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.5rem;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 0;
    color: var(--walnut);
    font-size: 0.78rem;
    cursor: pointer;
    text-align: left;
    font: inherit;
    width: 100%;
  }
  .year:hover { background: var(--ink-tint-04); color: var(--espresso); }
  .year.active {
    background: var(--brick-wash);
    color: var(--brick-deep);
  }
  .name { font-variant-numeric: tabular-nums; }
  .count {
    color: var(--faded);
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
  }
  .decade.active .count,
  .year.active .count { color: currentColor; opacity: 0.75; }
</style>
