<script lang="ts">
  import { plexState } from '../plex-state.svelte'
  import { formatListened, formatPlays } from '../../../../shared/charts'
  import type { ChartEntry } from '../../../../shared/charts'
  import ChartArt from './ChartArt.svelte'
  const c = $derived(plexState.charts)
  function explore(e: ChartEntry, dim: 'artists' | 'albums' | 'tracks'): void {
    if (dim === 'artists') void c.openArtist(e)
    else if (e.ratingKey) void plexState.openAlbumDetail(e.ratingKey)
    else if (e.subtitle) void plexState.openArtistByName(e.subtitle, {})
  }
</script>
{#if c.review && c.reviewYear}
  {@const review = c.review}
  {@const highlights = [
    { label: 'Top artist', entry: review.topArtist, dim: 'artists' as const },
    { label: 'Top album', entry: review.topAlbum, dim: 'albums' as const },
    { label: 'Top track', entry: review.topTrack, dim: 'tracks' as const }
  ]}
  {@const newArtists = review.newArtists.filter((e) => e.title !== review.topArtist?.title).slice(0, 12)}
  <section class="review">
    <div class="intro"><span class="kicker">Your year in music</span><h2>{c.reviewYear}</h2><p><strong>{formatListened(review.seconds)}</strong> <span>· {formatPlays(review.plays)}</span></p></div>
    <div class="highlights">
      {#each highlights as item}
        {#if item.entry}
          {@const entry = item.entry}
          <button class="hl" onclick={() => explore(entry, item.dim)}>
            <span class="hl-art" class:round={item.dim === 'artists'}><ChartArt {entry} dimension={item.dim} eager /></span>
            <span class="hl-copy"><span class="kicker">{item.label}</span><strong>{entry.title}</strong>{#if entry.subtitle}<small>{entry.subtitle}</small>{/if}</span>
          </button>
        {:else}
          <div class="hl empty"><span class="hl-copy"><span class="kicker">{item.label}</span><small>No plays logged</small></span></div>
        {/if}
      {/each}
    </div>
    {#if newArtists.length}
      <div class="discoveries">
        <span class="kicker">{review.newArtistCount.toLocaleString()} new {review.newArtistCount === 1 ? 'artist' : 'artists'} this year</span>
        <div class="new-row">
          {#each newArtists as e (e.title)}
            <button class="new" onclick={() => void c.openArtist(e)} title="{e.title} · {formatListened(e.seconds)}">
              <span class="new-art"><ChartArt entry={e} dimension="artists" /></span>
              <span class="new-name">{e.title}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </section>
{/if}
<style>
  .review { padding: 1.8rem 0; border-bottom: 1px solid var(--hairline); }
  .kicker { color: var(--faded); font-size: .7rem; letter-spacing: .1em; text-transform: uppercase; }
  h2 { font-family: var(--font-display); font-size: 3.7rem; letter-spacing: -.02em; margin: .2rem 0; line-height: 1.1; color: var(--espresso); }
  p { margin: .5rem 0 1.3rem; color: var(--faded); }
  p strong { color: var(--espresso); }
  button { background: none; border: 0; color: var(--espresso); cursor: pointer; font: inherit; text-align: left; padding: 0; }
  button:focus-visible { outline: 2px solid var(--brick); outline-offset: 3px; border-radius: var(--radius-md); }
  .highlights { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.5rem; }
  .hl { display: flex; align-items: center; gap: 1rem; min-width: 0; }
  .hl-art { flex-shrink: 0; width: 84px; height: 84px; border-radius: var(--radius-md); overflow: hidden; box-shadow: 0 6px 14px rgba(var(--shadow-color), 0.25); }
  .hl-art.round { border-radius: 50%; }
  .hl-copy { display: flex; flex-direction: column; gap: .2rem; min-width: 0; }
  .hl-copy strong { font-family: var(--font-display); font-weight: 600; font-size: 1.1rem; color: var(--espresso); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hl:hover .hl-copy strong { color: var(--brick-ink); }
  small { color: var(--faded); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .discoveries { margin-top: 1.6rem; }
  .new-row { display: flex; gap: 1rem; margin-top: .8rem; overflow-x: auto; padding-bottom: .3rem; }
  .new { display: flex; flex-direction: column; align-items: center; gap: .4rem; width: 72px; flex-shrink: 0; }
  .new-art { width: 60px; height: 60px; border-radius: 50%; overflow: hidden; }
  .new-name { font-size: .72rem; color: var(--walnut); text-align: center; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .new:hover .new-name { color: var(--brick-ink); }
  @media (max-width: 650px) { .highlights { grid-template-columns: 1fr; gap: .7rem; } }
</style>
