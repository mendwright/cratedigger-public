<script lang="ts">
  import { plexState } from '../lib/plex-state.svelte'
  import ScreenHeader from '../lib/ScreenHeader.svelte'
  import type { ChartWindow, ChartDimension, ChartEntry } from '../../../shared/charts'

  const c = $derived(plexState.charts)

  // Click-through: artists open their entity page (by name → MB → Plex), albums
  // and tracks open the album detail (tracks carry their album's rating key).
  function open(e: ChartEntry): void {
    if (c.dimension === 'artists') void plexState.openSearchArtist(e.title)
    else if (e.ratingKey) void plexState.openAlbumDetail(e.ratingKey)
  }

  const windows: { key: ChartWindow; label: string }[] = [
    { key: 'week', label: '7 days' },
    { key: 'month', label: '30 days' },
    { key: 'year', label: 'Year' },
    { key: 'all', label: 'All time' }
  ]
  const dimensions: { key: ChartDimension; label: string }[] = [
    { key: 'artists', label: 'Artists' },
    { key: 'albums', label: 'Albums' },
    { key: 'tracks', label: 'Tracks' }
  ]
</script>

<div class="page">
  <ScreenHeader
    --screen-header-bleed="1.75rem"
    --screen-header-max="900px"
    onback={() => plexState.closeCharts()}
    kicker="listening"
    title="Charts"
  />

  {#if c.users.length > 0}
    <div class="controls">
      <div class="seg">
        {#each dimensions as d (d.key)}
          <button class:active={c.dimension === d.key} onclick={() => c.setDimension(d.key)}>{d.label}</button>
        {/each}
      </div>
      <div class="seg">
        {#each windows as w (w.key)}
          <button class:active={c.window === w.key} onclick={() => c.setWindow(w.key)}>{w.label}</button>
        {/each}
      </div>
    </div>

    <div class="people">
      <button class="all" onclick={() => c.selectAll()} title="Include everyone">everyone</button>
      {#each c.users as u (u.userId)}
        <button
          class="chip"
          class:on={c.selected.has(u.userId)}
          onclick={() => c.toggleUser(u.userId)}
          title="{u.trackPlays.toLocaleString()} plays — click to toggle"
        >{u.name}</button>
      {/each}
    </div>

    {#if c.error}
      <div class="error">{c.error}</div>
    {:else if c.loading && !c.result}
      <div class="muted pad">Crunching the numbers…</div>
    {:else if c.result && c.result.entries.length > 0}
      <div class="grid" class:dim={c.loading}>
        {#each c.result.entries as e (e.rank + e.title)}
          {@const cover = plexState.thumbUrl(e.thumb, 240)}
          <button class="card" onclick={() => open(e)} title={e.subtitle ? `${e.title} — ${e.subtitle}` : e.title}>
            <div class="art" class:round={c.dimension === 'artists'}>
              {#if cover}
                <img src={cover} alt={e.title} loading="lazy" decoding="async" />
              {:else}
                <div class="fallback">{e.title.slice(0, 1)}</div>
              {/if}
              <span class="badge">{e.rank}</span>
            </div>
            <div class="meta">
              <span class="t">{e.title}</span>
              {#if e.subtitle}<span class="s">{e.subtitle}</span>{/if}
              <span class="p">{e.plays.toLocaleString()} plays</span>
            </div>
          </button>
        {/each}
      </div>
    {:else if c.selected.size === 0}
      <div class="muted pad">Pick at least one listener above.</div>
    {:else}
      <div class="muted pad">No plays in this window.</div>
    {/if}
  {:else if !c.ready || c.loading}
    <div class="muted pad">Loading charts…</div>
  {:else if c.error}
    <div class="empty">
      <p>Couldn't load charts.</p>
      <p class="muted">{c.error}</p>
    </div>
  {:else}
    <div class="empty">
      <p>No charts here yet.</p>
      <p class="muted">If this is your server, add Tautulli in <strong>Settings</strong> for live charts — otherwise they show up once they're published.</p>
      <button class="primary" onclick={() => void plexState.openSettings()}>Open Settings</button>
    </div>
  {/if}
</div>

<style>
  .page {
    max-width: 900px;
    margin: 0 auto;
    padding: 1.5rem 1.75rem 4rem;
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
    color: var(--paper);
    border: 0;
    padding: 0.5rem 1.1rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
  }
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
    color: var(--paper);
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
  .chip.on {
    background: var(--surface);
    border-color: var(--hairline-strong);
    color: var(--espresso);
  }
  .all { font-style: italic; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    gap: 1.1rem 1rem;
    transition: opacity 140ms ease;
  }
  .grid.dim { opacity: 0.45; }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
    border: 0;
    padding: 0;
    background: none;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .card:hover .art {
    transform: translateY(-2px);
  }
  .card:hover .art img,
  .card:hover .art .fallback {
    box-shadow: 0 5px 14px rgba(0, 0, 0, 0.3);
  }
  .card:hover .t {
    color: var(--brick);
  }
  .art {
    position: relative;
    aspect-ratio: 1;
    border-radius: 6px;
    /* No overflow:hidden here — it would clip the corner rank badge against
       the circular artist crop. The img/fallback clip themselves instead. */
    background: transparent;
    transition: transform 140ms ease;
  }
  .art.round { border-radius: 50%; }
  .art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: inherit;
    background: var(--surface);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
    transition: box-shadow 140ms ease;
  }
  .fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2.4rem;
    font-weight: 600;
    color: var(--faded);
    background: var(--ink-tint-06);
    border-radius: inherit;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  }
  .badge {
    position: absolute;
    top: 6px;
    left: 6px;
    min-width: 1.4rem;
    height: 1.4rem;
    padding: 0 0.35rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--brick) 92%, transparent);
    color: var(--paper);
    border-radius: var(--radius-pill);
    font-size: 0.74rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  }
  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .t {
    color: var(--espresso);
    font-weight: 500;
    font-size: 0.84rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .s {
    color: var(--faded);
    font-size: 0.74rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .p {
    color: var(--walnut);
    font-size: 0.74rem;
    font-variant-numeric: tabular-nums;
    margin-top: 0.1rem;
  }
  .error {
    color: var(--brick);
    padding: 1.5rem 0;
  }
</style>
