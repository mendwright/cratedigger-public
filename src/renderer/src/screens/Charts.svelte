<script lang="ts">
  import { PUBLIC_BUILD } from '../../../shared/build-flags'
  import { plexState } from '../lib/plex-state.svelte'
  import ChartRanking from '../lib/charts/ChartRanking.svelte'
  import ArtistDrillIn from '../lib/charts/ArtistDrillIn.svelte'
  import YearReview from '../lib/charts/YearReview.svelte'
  import ScreenHeader from '../lib/ScreenHeader.svelte'
  import type { ChartWindow, ChartDimension, ChartEntry } from '../../../shared/charts'
  import { formatListened } from '../../../shared/charts'

  const c = $derived(plexState.charts)
  $effect(() => {
    if (!c.artist) return
    const frame = requestAnimationFrame(() => document.querySelector('.artist-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    return () => cancelAnimationFrame(frame)
  })

  // Click-through: artists open their entity page (by name → MB → Plex), albums
  // and tracks open the album detail (tracks carry their album's rating key).
  // Older history entries for records not in the library have no rating key —
  // those open the artist instead, which is the next most useful place.
  function open(e: ChartEntry): void {
    if (c.dimension === 'artists') {
      void c.openArtist(e)
    }
    else if (e.ratingKey) void plexState.openAlbumDetail(e.ratingKey)
    else if (e.subtitle) void plexState.openArtistByName(e.subtitle, {})
  }

  // "Your years" strip: one bar per calendar year, height = hours listened.
  // Years with nothing logged stay in as empty slots so the gaps show (that's
  // where the Spotify / Apple Music exports will land).
  const years = $derived.by(() => {
    const ys = c.history?.years ?? []
    if (ys.length === 0) return []
    const have = new Map(ys.map((y) => [y.year, y]))
    const out = []
    for (let y = ys[0].year; y <= ys[ys.length - 1].year; y++) out.push(have.get(y) ?? { year: y, plays: 0, seconds: 0 })
    return out
  })
  const maxYearSeconds = $derived(Math.max(1, ...years.map((y) => y.seconds)))
  const sinceYear = $derived(years[0]?.year ?? null)
  const sourceLine = $derived(
    (c.history?.sources ?? [])
      .filter((s) => s.plays > 0 && s.first && s.last)
      .map((s) => {
        const a = new Date(s.first! * 1000).getFullYear()
        const b = new Date(s.last! * 1000).getFullYear()
        return a === b ? `${s.name} ${a}` : `${s.name} ${a}–${b}`
      })
      .join(' · ')
  )

  const windows: { key: ChartWindow; label: string }[] = [
    { key: 'week', label: '7 days' },
    { key: 'month', label: '30 days' },
    { key: 'year', label: 'This year' },
    { key: 'all', label: 'All time' }
  ]
  const dimensions: { key: ChartDimension; label: string }[] = [
    { key: 'artists', label: 'Artists' },
    { key: 'albums', label: 'Albums' },
    { key: 'tracks', label: 'Tracks' }
  ]
</script>

<div class="page">
  <ScreenHeader --screen-header-bleed="1.75rem" --screen-header-max="none" --screen-header-gap="1.1rem" onback={() => plexState.closeCharts()} kicker="listening" title="Charts" />
  {#if c.history}
    <nav class="tabs" aria-label="Whose listening"><button class:active={c.tab === 'you'} onclick={() => c.setTab('you')}>You</button><button class:active={c.tab === 'household'} onclick={() => c.setTab('household')}>Household</button></nav>
  {/if}
  {#if c.history || c.users.length}
    <div class="controls">
      <div class="dimension-controls"><div class="seg" role="group" aria-label="Chart type">{#each dimensions as d}<button class:active={c.dimension === d.key} aria-pressed={c.dimension === d.key} onclick={() => c.setDimension(d.key)}>{d.label}</button>{/each}</div>
        {#if !PUBLIC_BUILD && c.dimension === 'albums'}<button class="missing-filter" class:active={c.notInLibraryActive} aria-pressed={c.notInLibraryActive} onclick={() => c.toggleNotInLibrary()}>not in library</button>{/if}
      </div>
      <div class="seg" role="group" aria-label="Listening window">{#each windows as w}<button class:active={c.year === null && c.window === w.key} aria-pressed={c.year === null && c.window === w.key} onclick={() => c.setWindow(w.key)}>{c.tab === 'household' && w.key === 'year' ? '365 days' : w.label}</button>{/each}</div>
    </div>
    {#if c.tab === 'you' && c.history}
      <div class="years" role="group" aria-label="Pick a year">
        <button class="yr all" class:on={c.year === null && c.window === 'all'} onclick={() => c.setYear(null)} title="All listening since {sinceYear}"><span class="bar-wrap"><span class="bar" style="height:100%"></span></span><span class="lbl">all</span></button>
        {#each years as y}<button class="yr" class:on={c.reviewYear === y.year} class:empty={y.plays === 0} disabled={y.plays === 0} onclick={() => c.setYear(y.year)} title="{y.year}: {formatListened(y.seconds)} · {y.plays.toLocaleString()} plays"><span class="bar-wrap"><span class="bar" style:height={`${y.plays ? Math.max(4, y.seconds / maxYearSeconds * 100) : 0}%`}></span></span><span class="lbl">{String(y.year).slice(2)}</span></button>{/each}
      </div>
      <div class="sources muted">{c.year ?? (c.window === 'all' ? `since ${sinceYear}` : windows.find(w => w.key === c.window)?.label)}{#if sourceLine} · {sourceLine}{/if}</div>
      <YearReview />
    {:else}
      <div class="people"><button class="all" class:on={c.allSelected} onclick={() => c.selectAll()}>everyone</button>{#each c.users as u}<button class="chip" class:on={!c.allSelected && c.selected.has(u.userId)} onclick={e => e.metaKey || e.ctrlKey || e.shiftKey ? c.toggleUser(u.userId) : c.onlyUser(u.userId)} title="Click for {u.name}; ⌘-click to compare">{u.name}</button>{/each}</div>
    {/if}
    {#if c.error}<div class="error" role="status">{c.error}{#if c.result} Showing your saved chart.{/if}</div>{/if}
    {#if c.loading}<div class="status" role="status">{c.result ? 'Updating listening…' : 'Gathering your listening…'}</div>{/if}
    <div class="artist-panel"><ArtistDrillIn /></div>
    {#if c.entries.length}
      <div class="list-heading"><h2>{c.dimension}</h2><span>{c.entries.length} {c.notInLibraryActive ? 'not in library · from the top 500' : 'ranked by listening time'}</span></div>
      <ChartRanking entries={c.entries} dimension={c.dimension} onopen={open} />
      {#if !c.notInLibraryActive && c.tab === 'you' && (c.result?.entries.length ?? 0) >= c.limit && c.limit < 500}<button class="more" disabled={c.loading} onclick={() => c.showMore()}>Show 100 more</button>{/if}
    {:else if !c.loading && !c.error}<div class="muted pad">{c.notInLibraryActive ? 'No albums outside your library in this window’s top 500.' : 'No plays in this window.'}</div>{/if}
  {:else if !c.ready || c.loading}<div class="muted pad">Gathering your listening…</div>
  {:else}<div class="empty"><p>{c.error ?? 'No charts here yet.'}</p><p class="muted">Add Tautulli in Settings for live household charts, or wait for published charts.</p><button class="primary" onclick={() => void plexState.openSettings()}>Open Settings</button></div>{/if}
</div>

<style>
  .page {
    /* The screen shell (main.screen) is overflow: hidden and expects every
       screen to scroll itself — see Classical for the same shape. Without
       this, a chart taller than the window is just clipped. */
    height: 100%;
    overflow-y: auto;
    box-sizing: border-box;
    width: 100%;
    margin: 0 auto;
    /* No top padding — it would pin the sticky ScreenHeader below the
       visible top and open a see-through strip. See ScreenHeader's styles. */
    padding: 0 1.75rem 4rem;
  }
  .empty {
    text-align: center;
    padding: 4rem 1rem;
    color: var(--walnut);
  }
  .empty p { margin: 0 0 0.5rem; }
  .muted { color: var(--faded); }
  .pad { padding: 2rem 0; }
  .primary {
    margin-top: 1rem;
    background: var(--brick);
    color: var(--on-brick);
    border: 0;
    padding: 0.5rem 1.1rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
  }
  .dimension-controls { display: flex; align-items: center; flex-wrap: wrap; gap: .7rem; }
  .missing-filter { font: inherit; font-size: .78rem; border: 1px solid var(--hairline-strong); border-radius: var(--radius-pill); background: none; color: var(--faded); padding: .45rem .8rem; cursor: pointer; }
  .missing-filter.active { background: var(--brick); border-color: var(--brick); color: var(--on-brick); }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .seg button {
    background: transparent;
    border: 0;
    color: var(--walnut);
    padding: 0.34rem 0.85rem;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .seg button.active {
    background: var(--brick);
    color: var(--on-brick);
  }
  .people {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 1.25rem;
  }
  .chip, .all {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--faded);
    padding: 0.26rem 0.7rem;
    border-radius: var(--radius-pill);
    font-size: 0.74rem;
    cursor: pointer;
    transition: all 120ms ease;
  }
  .chip.on, .all.on {
    background: var(--surface);
    border-color: var(--hairline-strong);
    color: var(--espresso);
  }
  .all { font-style: italic; }
  .years {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    margin-bottom: 0.4rem;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .yr {
    flex: 1 0 1.5rem;
    max-width: 4rem;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.25rem;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    font: inherit;
  }
  .bar-wrap {
    height: 54px;
    display: flex;
    align-items: flex-end;
  }
  .bar {
    width: 100%;
    border-radius: 3px 3px 1px 1px;
    background: var(--hairline-strong);
    transition: background 120ms ease;
  }
  .yr:hover:not(:disabled) .bar { background: var(--faded); }
  .yr.empty { cursor: default; }
  .yr.empty .lbl { opacity: 0.45; }
  .yr.empty .bar-wrap { border-bottom: 1px dashed var(--hairline-strong); }
  .yr.on .bar { background: var(--brick); }
  .yr.all .bar { background: transparent; border: 1px dashed var(--hairline-strong); box-sizing: border-box; }
  .yr.all.on .bar { border-color: var(--brick); background: color-mix(in srgb, var(--brick) 18%, transparent); }
  .lbl {
    font-size: 0.66rem;
    color: var(--faded);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .yr.on .lbl { color: var(--espresso); font-weight: 600; }
  .sources {
    font-size: 0.74rem;
    margin-bottom: 1.25rem;
  }
  .artist-panel { scroll-margin-top: 6rem; }
  .tabs { display: flex; gap: 1.8rem; border-bottom: 1px solid var(--hairline); margin-bottom: 1.5rem; }
  .tabs button { font: inherit; font-size: 1.15rem; font-weight: 600; background: none; border: 0; border-bottom: 3px solid transparent; padding: .5rem 0 .8rem; color: var(--faded); cursor: pointer; }
  .tabs button.active { border-color: var(--brick); color: var(--espresso); }
  .controls { justify-content: space-between; align-items: center; }
  .seg button { padding: .55rem 1.1rem; font-size: .85rem; }
  .status { color: var(--faded); font-size: .75rem; padding: .5rem 0; }
  .list-heading { margin: 1.5rem 0 0; display: flex; align-items: baseline; justify-content: space-between; color: var(--faded); }
  .list-heading h2 { color: var(--espresso); font-size: 1.2rem; font-weight: 600; text-transform: capitalize; }
  .list-heading span { font-size: .75rem; }
  .more { display: block; margin: 1.5rem auto; background: var(--surface); border: 1px solid var(--hairline-strong); border-radius: var(--radius-pill); padding: .6rem 1.5rem; color: var(--espresso); cursor: pointer; }
</style>
