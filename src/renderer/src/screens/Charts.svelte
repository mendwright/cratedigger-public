<script lang="ts">
  import { PUBLIC_BUILD } from '../../../shared/build-flags'
  import { plexState } from '../lib/plex-state.svelte'
  import ChartRanking from '../lib/charts/ChartRanking.svelte'
  import ArtistDrillIn from '../lib/charts/ArtistDrillIn.svelte'
  import YearReview from '../lib/charts/YearReview.svelte'
  import ScreenHeader from '../lib/ScreenHeader.svelte'
  import type { ChartWindow, ChartDimension, ChartEntry } from '../../../shared/charts'
  import { formatListened, formatPlays } from '../../../shared/charts'

  const c = $derived(plexState.charts)
  // The drill-in opens under the entry you clicked. It only falls back to the
  // top of the chart for artists opened from elsewhere (the year review, the
  // artist page's "see them in charts").
  const entryKey = (e: ChartEntry): string => `${e.rank}|${e.title}|${e.subtitle}`
  const drillKey = $derived(c.artist ? entryKey(c.artist) : null)
  const drillInList = $derived(!!drillKey && c.dimension === 'artists' && c.entries.some((e) => entryKey(e) === drillKey))
  $effect(() => {
    if (!c.artist) return
    const frame = requestAnimationFrame(() => document.querySelector('.artist-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
    return () => cancelAnimationFrame(frame)
  })
  // Closing hands focus back to whatever opened the drill-in, so keyboard and
  // screen-reader users land where they were in the list.
  let opener: HTMLElement | null = null
  $effect(() => {
    if (c.artist) return
    const el = opener
    opener = null
    if (el?.isConnected) el.focus({ preventScroll: true })
  })

  // Click-through: artists open their entity page (by name → MB → Plex), albums
  // and tracks open the album detail (tracks carry their album's rating key).
  // Older history entries for records not in the library have no rating key —
  // those open the artist instead, which is the next most useful place.
  function open(e: ChartEntry): void {
    if (c.dimension === 'artists') {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
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

{#snippet drillPanel()}<div class="artist-panel"><ArtistDrillIn /></div>{/snippet}

<div class="page">
  <ScreenHeader --screen-header-bleed="1.75rem" --screen-header-max="none" --screen-header-gap="1.1rem" onback={() => plexState.closeCharts()} kicker="listening" title="Charts" />
  {#if c.history || c.users.length}
    <!-- One row of "what": kind, plus whose listening as a small switch. -->
    <div class="controls">
      <div class="dimension-controls"><div class="seg" role="group" aria-label="Chart type">{#each dimensions as d}<button class:active={c.dimension === d.key} aria-pressed={c.dimension === d.key} onclick={() => c.setDimension(d.key)}>{d.label}</button>{/each}</div>
        {#if !PUBLIC_BUILD && c.dimension === 'albums'}<button class="missing-filter" class:active={c.notInLibraryActive} aria-pressed={c.notInLibraryActive} onclick={() => c.toggleNotInLibrary()}>not in library</button>{/if}
      </div>
      {#if c.history}
        <div class="seg whose" role="group" aria-label="Whose listening"><button class:active={c.tab === 'you'} aria-pressed={c.tab === 'you'} onclick={() => c.setTab('you')}>You</button><button class:active={c.tab === 'household'} aria-pressed={c.tab === 'household'} onclick={() => c.setTab('household')}>Household</button></div>
      {/if}
    </div>
    {#if c.tab === 'you' && c.history}
      <!-- One row of "when": the recent windows, then every year, with "all"
           standing for all time. Used to be a range segment plus a separate
           strip plus a sources line, three controls for one question. -->
      <div class="time" role="group" aria-label="When" title={sourceLine ? `Your history: ${sourceLine}` : undefined}>
        <div class="seg ranges">{#each windows.filter((w) => w.key !== 'all') as w}<button class:active={c.year === null && c.window === w.key} aria-pressed={c.year === null && c.window === w.key} onclick={() => c.setWindow(w.key)}>{w.label}</button>{/each}</div>
        <div class="years">
        <button class="yr all" class:on={c.year === null && c.window === 'all'} aria-pressed={c.year === null && c.window === 'all'} onclick={() => c.setYear(null)} title="All time: everything since {sinceYear}"><span class="bar-wrap"><span class="bar" style="height:100%"></span></span><span class="lbl">all</span></button>
        {#each years as y}<button class="yr" class:on={c.reviewYear === y.year} class:empty={y.plays === 0} disabled={y.plays === 0} onclick={() => c.setYear(y.year)} title={y.plays === 0 ? `${y.year}: no listening history for this year` : `${y.year}: ${formatListened(y.seconds)} · ${formatPlays(y.plays)}`}><span class="bar-wrap"><span class="bar" style:height={`${y.plays ? Math.max(4, y.seconds / maxYearSeconds * 100) : 0}%`}></span></span><span class="lbl">{String(y.year).slice(2)}</span></button>{/each}
        </div>
      </div>
      <YearReview />
    {:else}
      <div class="time"><div class="seg ranges" role="group" aria-label="Listening window">{#each windows as w}<button class:active={c.window === w.key} aria-pressed={c.window === w.key} onclick={() => c.setWindow(w.key)}>{w.key === 'year' ? '365 days' : w.label}</button>{/each}</div></div>
      <div class="people"><button class="all" class:on={c.allSelected} onclick={() => c.selectAll()}>everyone</button>{#each c.users as u}<button class="chip" class:on={!c.allSelected && c.selected.has(u.userId)} onclick={e => e.metaKey || e.ctrlKey || e.shiftKey ? c.toggleUser(u.userId) : c.onlyUser(u.userId)} title="Click for {u.name}; ⌘-click to compare">{u.name}</button>{/each}</div>
    {/if}
    {#if c.error}<div class="error" role="status">{c.error}{#if c.result} Showing your saved chart.{/if}</div>{/if}
    {#if c.loading}<div class="status" role="status">{c.result ? 'Updating listening…' : c.tab === 'household' ? 'Gathering the household’s listening…' : 'Gathering your listening…'}</div>{/if}
    {#if !drillInList}<div class="artist-panel"><ArtistDrillIn /></div>{/if}
    {#if c.entries.length}
      <div class="list-heading"><h2>{c.dimension}</h2><span>{c.entries.length} {c.notInLibraryActive ? 'not in library · from the top 500' : c.dimension === 'tracks' ? 'ranked by plays' : 'ranked by listening time'}</span></div>
      <ChartRanking entries={c.entries} dimension={c.dimension} onopen={open} yearSpan={c.tab === 'you' ? years.map((y) => y.year) : []} drill={drillInList ? drillPanel : undefined} {drillKey} />
      {#if !c.notInLibraryActive && c.tab === 'you' && (c.result?.entries.length ?? 0) >= c.limit && c.limit < 500}<button class="more" disabled={c.loading} onclick={() => c.showMore()}>Show 100 more</button>{/if}
    {:else if !c.loading && !c.error}<div class="muted pad">{c.notInLibraryActive ? 'No albums outside your library in this window’s top 500.' : 'No plays in this window.'}</div>{/if}
  {:else if !c.ready || c.loading}<div class="muted pad">{c.tab === 'household' ? 'Gathering the household’s listening…' : 'Gathering your listening…'}</div>
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
  /* Mustard marks where you are (DESIGN.md: orange acts, mustard locates). */
  .seg button.active {
    background: var(--crate-mustard);
    color: var(--on-brick);
    font-weight: 600;
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
    height: 40px;
    display: flex;
    align-items: flex-end;
  }
  .bar {
    width: 100%;
    border-radius: 3px 3px 1px 1px;
    /* 60% faded on paper: 3.1:1, enough to read as data (hairline was 2.2:1). */
    background: color-mix(in srgb, var(--faded) 60%, var(--paper));
    transition: background 120ms ease;
  }
  .yr:hover:not(:disabled) .bar { background: var(--faded); }
  .yr.empty { cursor: default; }
  .yr.empty .lbl { opacity: 0.45; }
  .yr.empty .bar-wrap { border-bottom: 1px dashed var(--hairline-strong); }
  .yr.on .bar { background: var(--crate-mustard); }
  .yr.all .bar { background: transparent; border: 1px dashed var(--hairline-strong); box-sizing: border-box; }
  .yr.all.on .bar { border-color: var(--crate-mustard); background: color-mix(in srgb, var(--crate-mustard) 18%, transparent); }
  .lbl {
    font-size: 0.7rem;
    color: var(--faded);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .yr.on .lbl { color: var(--espresso); font-weight: 600; }
  .artist-panel { scroll-margin-top: 6rem; }
  .controls { justify-content: space-between; align-items: center; }
  .seg.whose button { padding: .4rem .9rem; font-size: .78rem; }
  .time { display: flex; align-items: flex-end; gap: 1.25rem; margin-bottom: 1.4rem; }
  .time .ranges { flex-shrink: 0; margin-bottom: 1.1rem; }
  .time .years { flex: 1 1 auto; min-width: 0; margin-bottom: 0; }
  .seg button { padding: .55rem 1.1rem; font-size: .85rem; }
  .status { color: var(--faded); font-size: .75rem; padding: .5rem 0; }
  .list-heading { margin: 1.5rem 0 0; display: flex; align-items: baseline; justify-content: space-between; color: var(--faded); }
  .list-heading h2 { color: var(--espresso); font-family: var(--font-display); font-size: 1.3rem; font-weight: 600; text-transform: capitalize; }
  .list-heading span { font-size: .75rem; }
  .more { display: block; margin: 1.5rem auto; background: var(--surface); border: 1px solid var(--hairline-strong); border-radius: var(--radius-pill); padding: .6rem 1.5rem; color: var(--espresso); cursor: pointer; }
</style>
