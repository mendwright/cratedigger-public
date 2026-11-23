<script lang="ts">
  import type { ChartDimension, ChartEntry } from '../../../../shared/charts'
  import { formatListened, formatPlays } from '../../../../shared/charts'

  // "When did I love this": one tiny bar per year of your whole history, so a
  // glance down the list tells 2008 loves from this month's. Every row uses the
  // same year span, so the columns line up row to row. Fetched lazily, only
  // once the row scrolls into view; the history service memoises answers.
  let { entry, dimension, span }: { entry: ChartEntry; dimension: ChartDimension; span: number[] } = $props()

  let host: HTMLDivElement | undefined = $state()
  let years = $state<Map<number, { plays: number; seconds: number }> | null>(null)

  $effect(() => {
    const el = host
    const item = { title: entry.title, subtitle: entry.subtitle }
    const dim = dimension
    years = null
    if (!el || !window.cratedigger.history) return
    const args =
      dim === 'artists'
        ? { artist: item.title }
        : dim === 'albums'
          ? item.subtitle ? { artist: item.subtitle, album: item.title } : null
          : item.subtitle ? { artist: item.subtitle, track: item.title } : null
    if (!args) return
    let live = true
    const io = new IntersectionObserver((seen) => {
      if (!seen.some((s) => s.isIntersecting)) return
      io.disconnect()
      void window.cratedigger.history
        .item(args)
        .then((stats) => {
          if (!live || !stats) return
          years = new Map(stats.years.map((y) => [y.year, { plays: y.plays, seconds: y.seconds ?? 0 }]))
        })
        .catch(() => {})
    }, { rootMargin: '200px 0px' })
    io.observe(el)
    return () => {
      live = false
      io.disconnect()
    }
  })

  // Height by time listened (plays for old entries with no seconds), against
  // this row's own best year: the shape matters here, not the size.
  const measure = (y: { plays: number; seconds: number }): number => y.seconds || y.plays
  const peak = $derived(years ? Math.max(1, ...[...years.values()].map(measure)) : 1)
  const summary = $derived.by(() => {
    if (!years || years.size === 0) return ''
    const best = [...years.entries()].sort((a, b) => measure(b[1]) - measure(a[1]))[0]
    return `Most in ${best[0]}: ${best[1].seconds ? formatListened(best[1].seconds) + ' · ' : ''}${formatPlays(best[1].plays)}`
  })
</script>

<div class="years" bind:this={host} title={summary} aria-label={summary || undefined} role={summary ? 'img' : undefined}>
  {#if years}
    {#each span as y (y)}
      {@const v = years.get(y)}
      <span class="col"><span class="bar" style:height={v ? `${Math.max(12, (measure(v) / peak) * 100)}%` : '0'}></span></span>
    {/each}
  {/if}
</div>

<style>
  .years {
    display: flex;
    align-items: flex-end;
    gap: 1px;
    height: 22px;
    width: 100%;
    max-width: 150px;
    justify-self: end;
  }
  .col {
    flex: 1 1 0;
    height: 100%;
    display: flex;
    align-items: flex-end;
    border-bottom: 1px solid var(--ink-tint-08);
  }
  @media (max-width: 650px) {
    .years { display: none; }
  }
  .bar {
    width: 100%;
    background: var(--faded);
    border-radius: 1px 1px 0 0;
    opacity: 0.85;
  }
</style>
