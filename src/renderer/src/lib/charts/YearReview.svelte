<script lang="ts">
  import { plexState } from '../plex-state.svelte'
  import { formatListened } from '../../../../shared/charts'
  import type { ChartEntry } from '../../../../shared/charts'
  const c = $derived(plexState.charts)
  function explore(e: ChartEntry, dim: 'artists' | 'albums' | 'tracks'): void {
    if (dim === 'artists') void c.openArtist(e)
    else if (e.ratingKey) void plexState.openAlbumDetail(e.ratingKey)
    else if (e.subtitle) void plexState.openArtistByName(e.subtitle, {})
  }
</script>
{#if c.review && c.reviewYear}
  <section class="review">
    <div class="intro"><span class="kicker">Your year in music</span><h2>{c.reviewYear}</h2><p><strong>{formatListened(c.review.seconds)}</strong> <span>· {c.review.plays.toLocaleString()} plays</span></p></div>
    <div class="highlights">
      {#each [{ label: 'Top artist', entry: c.review.topArtist, dim: 'artists' as const }, { label: 'Top album', entry: c.review.topAlbum, dim: 'albums' as const }, { label: 'Top track', entry: c.review.topTrack, dim: 'tracks' as const }] as item}
        <div><span class="kicker">{item.label}</span>{#if item.entry}<button onclick={() => explore(item.entry!, item.dim)}>{item.entry.title}</button>{#if item.entry.subtitle}<small>{item.entry.subtitle}</small>{/if}{:else}<p>No plays logged</p>{/if}</div>
      {/each}
    </div>
    {#if c.review.newArtists.length}<div class="discoveries"><span class="kicker">{c.review.newArtistCount.toLocaleString()} new artists this year</span><div>{#each c.review.newArtists as e}<button onclick={() => void c.openArtist(e)}>{e.title}<span>{formatListened(e.seconds)}</span></button>{/each}</div></div>{/if}
  </section>
{/if}
<style>
  .review { padding: 1.8rem 0; border-bottom: 1px solid var(--hairline); }
  .kicker { color: var(--faded); font-size: .67rem; letter-spacing: .1em; text-transform: uppercase; }
  h2 { font-size: 3.7rem; letter-spacing: -.06em; margin: .2rem 0; line-height: 1.1; color: var(--espresso); }
  p { margin: .5rem 0 1.3rem; color: var(--faded); }
  p strong { color: var(--espresso); }
  .highlights { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.5rem; }
  .highlights > div { min-width: 0; }
  button { background: none; border: 0; color: var(--espresso); cursor: pointer; font: inherit; text-align: left; padding: 0; }
  button:hover { color: var(--brick); }
  .highlights button { display: block; font-weight: 600; font-size: 1.1rem; margin: .5rem 0 .2rem; }
  small { color: var(--faded); }
  .discoveries { margin-top: 1.5rem; }
  .discoveries > div { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .7rem; }
  .discoveries button { border: 1px solid var(--hairline); border-radius: var(--radius-pill); padding: .35rem .65rem; font-size: .75rem; }
  .discoveries span { color: var(--faded); margin-left: .5rem; font-size: .68rem; }
  @media (max-width: 650px) { .highlights { grid-template-columns: 1fr; gap: .7rem; } }
</style>
