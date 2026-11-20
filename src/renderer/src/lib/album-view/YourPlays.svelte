<script lang="ts">
  import { formatListened } from '../../../../shared/charts'
  import { monthYear, type HistoryItemStats } from '../../../../shared/listening-history'

  // How much you've played this album (or artist, when `album` is omitted),
  // across your whole history — Last.fm back to 2005 plus the Plex log — with
  // first / last heard and a little bar per year. Quiet when there's no
  // history for this account or it's never been played.
  // `compact` = one line, for the artist page hero.
  // `found` reports back whether there's history to show, so the album page
  // can retire its rougher Plex-only play count instead of printing two
  // different "plays" numbers one above the other.
  let {
    artist,
    album = null,
    compact = false,
    onCharts = null,
    found = $bindable(false)
  }: {
    artist: string
    album?: string | null
    compact?: boolean
    onCharts?: (() => void) | null
    found?: boolean
  } = $props()

  let stats = $state<HistoryItemStats | null>(null)

  $effect(() => {
    const a = artist
    const b = album
    stats = null
    found = false
    if (!a || !window.cratedigger.history) return
    let live = true
    window.cratedigger.history
      .item({ artist: a, album: b })
      .then((s) => {
        if (!live) return
        stats = s && s.plays > 0 ? s : null
        found = stats !== null
      })
      .catch(() => {})
    return () => {
      live = false
    }
  })

  const span = $derived.by(() => {
    if (!stats || stats.years.length === 0) return []
    const byYear = new Map(stats.years.map((y) => [y.year, y.plays]))
    const first = stats.years[0].year
    const last = stats.years[stats.years.length - 1].year
    const out: { year: number; plays: number }[] = []
    for (let y = first; y <= last; y++) out.push({ year: y, plays: byYear.get(y) ?? 0 })
    return out
  })
  const peak = $derived(Math.max(1, ...span.map((y) => y.plays)))
</script>

{#if stats && compact}
  <div class="compact" data-your-plays title="Across your whole listening history">
    you've played them <strong>{stats.plays.toLocaleString()}</strong> {stats.plays === 1 ? 'time' : 'times'}
    {` · ${formatListened(stats.seconds)}`}{#if stats.first}{` · since ${monthYear(stats.first)}`}{/if}
    {#if onCharts}<button class="charts-link" onclick={onCharts}>see them in charts →</button>{/if}
  </div>
{:else if stats}
  <section class="yours" data-your-plays aria-label="Your plays">
    <div class="head">your plays</div>
    <div class="line">
      <strong>{stats.plays.toLocaleString()}</strong> {stats.plays === 1 ? 'play' : 'plays'}
      <span class="dim">· {formatListened(stats.seconds)}</span>
    </div>
    {#if stats.first && stats.last}
      <div class="dim when">
        {#if monthYear(stats.first) === monthYear(stats.last)}
          heard {monthYear(stats.first)}
        {:else}
          first {monthYear(stats.first)} · last {monthYear(stats.last)}
        {/if}
      </div>
    {/if}
    {#if span.length > 1}
      <div class="spark" aria-hidden="true">
        {#each span as y (y.year)}
          <span class="b" style="height: {y.plays ? Math.max(8, (y.plays / peak) * 100) : 0}%" title="{y.year}: {y.plays} plays"></span>
        {/each}
      </div>
      <div class="ends dim"><span>{span[0].year}</span><span>{span[span.length - 1].year}</span></div>
    {/if}
  </section>
{/if}

<style>
  .compact {
    margin-top: 0.5rem;
    font-size: 0.78rem;
    color: var(--walnut);
    font-variant-numeric: tabular-nums;
  }
  .compact strong {
    color: var(--espresso);
  }
  .charts-link {
    margin-left: 0.6rem;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--brick);
    cursor: pointer;
  }
  .charts-link:hover {
    text-decoration: underline;
  }
  .yours {
    margin: 1rem 0 0;
    padding-top: 1rem;
    border-top: 1px solid var(--hairline);
  }
  .head {
    font-size: 0.78rem;
    text-transform: lowercase;
    letter-spacing: 0.04em;
    color: var(--faded);
    margin-bottom: 0.45rem;
  }
  .line {
    font-size: 0.84rem;
    color: var(--espresso);
    font-variant-numeric: tabular-nums;
  }
  .dim {
    color: var(--faded);
  }
  .when {
    font-size: 0.74rem;
    margin-top: 0.1rem;
  }
  .spark {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 26px;
    margin-top: 0.55rem;
  }
  .b {
    flex: 1;
    background: var(--brick);
    opacity: 0.75;
    border-radius: 1px;
  }
  .ends {
    display: flex;
    justify-content: space-between;
    font-size: 0.7rem;
    margin-top: 0.2rem;
    font-variant-numeric: tabular-nums;
  }
</style>
