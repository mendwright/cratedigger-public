<script lang="ts">
  import type { ChartEntry, ChartDimension } from '../../../../shared/charts'
  import { formatListened } from '../../../../shared/charts'
  import { plexState } from '../plex-state.svelte'
  import ChartArt from './ChartArt.svelte'
  import { PUBLIC_BUILD } from '../../../../shared/build-flags'
  import ChartHero from './ChartHero.svelte'
  let { entries, dimension, onopen, compact = false }: { entries: ChartEntry[]; dimension: ChartDimension; onopen: (entry: ChartEntry) => void; compact?: boolean } = $props()
  const max = $derived(Math.max(1, ...entries.map(e => e.seconds || e.plays)))
  function play(e: ChartEntry): void {
    if (e.ratingKey) void plexState.playback.requestCastAlbum(e.ratingKey, e.title, e.subtitle ?? '')
  }
  // Not in the library (no Plex key) → offer Soulseek instead of play.
  // Tracks search the LP they belong to (MusicBrainz lookup), not the single.
  function canGrab(e: ChartEntry): boolean {
    return !PUBLIC_BUILD && dimension !== 'artists' && !e.ratingKey && !!e.subtitle
  }
  function grab(e: ChartEntry): void {
    if (!e.subtitle) return
    if (dimension === 'tracks') void plexState.findGapAlbumOnSlskd(e.subtitle, e.title, e.album ?? null)
    else void plexState.findGapOnSlskd(e.subtitle, e.title)
  }
  // #1 is a 2×2 tile at the head of the grid (4 cells). 8 more cards make
  // 12 cells, so rows come out whole at both 6 and 4 columns.
  const cardCount = 8
  const cards = $derived(entries.slice(1, 1 + cardCount))
  const listed = $derived(compact ? entries : entries.slice(1 + cardCount))
</script>
{#snippet playButton(e: ChartEntry)}
  {#if dimension === 'albums' && e.ratingKey}
    <button class="play" onclick={() => play(e)} title="Play {e.title}" aria-label="Play {e.title}">▶</button>
  {:else if canGrab(e)}
    <button class="play grab" onclick={() => grab(e)} title="Not in your library — search Soulseek for {e.subtitle} – {dimension === 'tracks' ? (e.album ?? e.title) : e.title}" aria-label="Search Soulseek for {e.title}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>
    </button>
  {/if}
{/snippet}
{#if !compact && entries[0]}
  <div class="grid">
    <ChartHero entry={entries[0]} {dimension} {onopen} onplay={play} />
    {#each cards as e (`${e.rank}|${e.title}|${e.subtitle}`)}
      <article class="card">
        <div class="card-art"><button class="art-button" onclick={() => onopen(e)} aria-label="Explore {e.title}"><ChartArt entry={e} {dimension} eager={e.rank <= 7} /></button><span class="rank">{e.rank}</span>{@render playButton(e)}</div>
        <button class="card-title" onclick={() => onopen(e)} title={e.title}>{e.title}</button>
        {#if e.subtitle}<span class="subtitle ellipsis">{e.subtitle}</span>{/if}
        <span class="numbers">{formatListened(e.seconds)} <span>· {e.plays.toLocaleString()} plays</span></span>
      </article>
    {/each}
  </div>
{/if}
<div class="ranking">
  {#each listed as e (`${e.rank}|${e.title}|${e.subtitle}`)}
    <div class="row">
      <span class="row-rank">{e.rank}</span>
      <div class="row-art"><ChartArt entry={e} {dimension} />{@render playButton(e)}</div>
      <button class="row-name" onclick={() => onopen(e)}><span class="bar" style:width={`${Math.max(1, (e.seconds || e.plays) / max * 100)}%`}></span><span class="row-copy"><strong>{e.title}</strong>{#if e.subtitle}<span class="subtitle">{e.subtitle}</span>{/if}</span></button>
      <div class="row-stats"><strong>{formatListened(e.seconds)}</strong><span>{e.plays.toLocaleString()} plays</span></div>
    </div>
  {/each}
</div>
<style>
  button { font: inherit; color: inherit; cursor: pointer; }
  .art-button { display: block; border: 0; background: none; padding: 0; width: 100%; height: 100%; border-radius: inherit; }
  .card-title:hover, .row-name:hover { color: var(--brick); }
  .subtitle { color: var(--faded); font-size: .8rem; }
  .grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 1.8rem 1.2rem; margin-bottom: 2.5rem; }
  .card { min-width: 0; display: flex; flex-direction: column; gap: .3rem; }
  .card-art { position: relative; aspect-ratio: 1; border-radius: 6px; margin-bottom: .35rem; }
  .rank { position: absolute; top: .6rem; left: .6rem; border-radius: var(--radius-pill); background: var(--brick); color: var(--on-brick); padding: .2rem .5rem; font-size: .75rem; pointer-events: none; }
  .card-title { font-weight: 600; font-size: .92rem; color: var(--espresso); text-align: left; background: none; border: 0; padding: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .ellipsis { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .numbers { color: var(--espresso); font-size: .78rem; font-variant-numeric: tabular-nums; }
  .numbers span { color: var(--faded); font-size: .7rem; }
  .play { position: absolute; right: .6rem; bottom: .6rem; background: var(--brick); color: var(--on-brick); border: 0; border-radius: 50%; width: 2.5rem; height: 2.5rem; opacity: 0; transition: opacity 120ms; box-shadow: 0 2px 8px rgba(var(--shadow-color), .3); }
  .grab { display: grid; place-items: center; background: color-mix(in srgb, var(--espresso) 85%, transparent); color: var(--surface); }
  .grab svg { width: 50%; height: 50%; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; }
  .card:hover .play, .row:hover .play, .play:focus-visible { opacity: 1; }
  .ranking { border-top: 1px solid var(--hairline); }
  .row { display: grid; grid-template-columns: 2.3rem 48px minmax(0, 1fr) 100px; align-items: center; gap: 1rem; padding: .6rem 0; border-bottom: 1px solid var(--hairline); }
  .row-rank { color: var(--faded); font-size: .78rem; text-align: center; font-variant-numeric: tabular-nums; }
  .row-art { position: relative; width: 48px; height: 48px; border-radius: 4px; }
  .row-art .play { width: 2rem; height: 2rem; bottom: .2rem; right: .2rem; }
  .row-name { position: relative; min-height: 48px; background: none; border: 0; border-radius: 3px; text-align: left; padding: .4rem .8rem; overflow: hidden; }
  .bar { position: absolute; left: 0; top: 0; bottom: 0; background: color-mix(in srgb, var(--brick) 12%, transparent); border-radius: 3px; }
  .row-copy { position: relative; display: flex; flex-direction: column; gap: .2rem; }
  .row-copy strong { font-size: .87rem; font-weight: 500; }
  .row-stats { display: flex; flex-direction: column; text-align: right; gap: .2rem; font-variant-numeric: tabular-nums; }
  .row-stats strong { font-size: .85rem; font-weight: 500; color: var(--espresso); }
  .row-stats span { color: var(--faded); font-size: .7rem; }
  @media (max-width: 1200px) { .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  @media (max-width: 650px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .row { gap: .5rem; grid-template-columns: 1.5rem 40px minmax(0, 1fr) 65px; } .row-art { width: 40px; height: 40px; } .play { opacity: 1; } }
  @media (hover: none) { .play { opacity: 1; } }
</style>
