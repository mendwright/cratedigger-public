<script lang="ts">
  import { plexState } from '../plex-state.svelte'
  import { isAmbiguousArtistBio } from '../../../../shared/bio-text'
  import { cleanChartBio } from './bio-excerpt'
  import { monthYear } from '../../../../shared/listening-history'
  import type { ArtistBio } from '../../../../shared/plex'
  import { formatListened } from '../../../../shared/charts'
  import ChartArt from './ChartArt.svelte'
  import ChartRanking from './ChartRanking.svelte'
  const c = $derived(plexState.charts)
  let bio = $state<ArtistBio | null>(null)
  let bioLoading = $state(false)
  $effect(() => {
    const name = c.artist?.title
    bio = null
    bioLoading = !!name
    if (!name) return
    let live = true
    void (async () => {
      try {
        const mbid = await window.cratedigger.plex.searchArtistByName({ name })
        if (!live || !mbid) return
        const fetched = await window.cratedigger.plex.getArtistBio({ mbid, name })
        if (live) bio = fetched
      } catch { /* Biography is optional; listening details remain usable. */ }
      finally { if (live) bioLoading = false }
    })()
    return () => { live = false }
  })
  const bioText = $derived.by(() => {
    const doc = new DOMParser().parseFromString(bio?.text ?? '', 'text/html')
    doc.querySelectorAll('script, style').forEach(node => node.remove())
    const text = cleanChartBio(doc.body.textContent ?? '')
    return isAmbiguousArtistBio(text) ? '' : text
  })
  const lifetimeSeconds = $derived(
    (c.artistStats as (typeof c.artistStats & { allSeconds?: number }))?.allSeconds ??
    c.artistStats?.years.reduce((total, y) => total + y.seconds, 0) ?? 0
  )
  function openPage(): void {
    if (c.artist) void plexState.openArtistByName(c.artist.title, { plexRatingKey: c.artist.ratingKey })
  }
  const artistYears = $derived.by(() => {
    const ys = c.artistStats?.years ?? []
    if (!ys.length) return []
    const have = new Map(ys.map(y => [y.year, y]))
    return Array.from({ length: ys[ys.length - 1].year - ys[0].year + 1 }, (_, i) => have.get(ys[0].year + i) ?? { year: ys[0].year + i, plays: 0, seconds: 0 })
  })
  const max = $derived(Math.max(1, ...(c.artistStats?.years ?? []).map(y => y.seconds)))
</script>
{#if c.artist}
  <section class="drill" aria-label="{c.artist.title} listening details">
    <button class="close" onclick={() => c.closeArtist()} aria-label="Close artist details">×</button>
    <div class="overview">
      <div class="listening">
        <header><div class="portrait"><ChartArt entry={c.artist} dimension="artists" eager /></div><div><span class="kicker">Artist in this chart</span><h2>{c.artist.title}</h2><button class="link" onclick={openPage}>Open artist page ↗</button></div></header>
        {#if c.artistStats?.years.length}
          <h3>Hours through the years</h3>
          <div class="timeline" aria-label="Hours listened per year">
            {#each artistYears as y (y.year)}<button class:chosen={c.reviewYear === y.year} disabled={!y.plays} onclick={() => c.setYear(y.year)} title="{y.year}: {formatListened(y.seconds)} · {y.plays.toLocaleString()} plays"><span class="bar-wrap"><span class="bar" style:height={`${y.plays ? Math.max(3, y.seconds / max * 100) : 0}%`}></span></span><span>{y.year}</span></button>{/each}
          </div>
        {/if}
      </div>
      <aside class="about" aria-label="About {c.artist.title}">
        {#if bioText}<p class="bio">{bioText}</p><button class="link more" onclick={openPage}>more ↗</button>
        {:else if bioLoading}<p class="muted">Loading artist biography…</p>
        {:else}<p class="muted">Explore {c.artist.title}’s records and credits on their artist page.</p>{/if}
        {#if bio?.tags.length}<div class="tags" aria-label="Artist tags">{#each bio.tags.slice(0, 8) as tag}<span>{tag}</span>{/each}</div>{/if}
        {#if c.artistStats && (c.artistStats.first || lifetimeSeconds)}
          <div class="history-facts">{#if c.artistStats.first}<span>First heard <strong>{monthYear(c.artistStats.first)}</strong></span>{/if}{#if lifetimeSeconds}<span><strong>{formatListened(lifetimeSeconds)}</strong> all time</span>{/if}</div>
        {/if}
      </aside>
    </div>
    {#if c.artistLoading}<p class="muted">Loading listening details…</p>
    {:else if c.artistError}<p class="muted">{c.artistError}</p>
    {:else}
      <div class="columns"><div><h3>Top albums · this window</h3><ChartRanking entries={c.artistAlbums} dimension="albums" compact onopen={e => { if (e.ratingKey) void plexState.openAlbumDetail(e.ratingKey) }} />{#if !c.artistAlbums.length}<p class="muted">No albums logged.</p>{/if}</div><div><h3>Top tracks · this window</h3><ChartRanking entries={c.artistTracks} dimension="tracks" compact onopen={e => { if (e.ratingKey) void plexState.openAlbumDetail(e.ratingKey) }} />{#if !c.artistTracks.length}<p class="muted">No tracks logged.</p>{/if}</div></div>
    {/if}
  </section>
{/if}
<style>
  .drill { position: relative; border: 1px solid var(--hairline-strong); border-radius: 10px; background: var(--surface); padding: 1.5rem; margin: 1.5rem 0; }
  .overview { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 2rem; }
  .listening, .about { min-width: 0; }
  .about { padding-right: 1.5rem; }
  .bio { display: -webkit-box; line-clamp: 5; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; color: var(--espresso); font-size: .87rem; line-height: 1.65; margin: 0 0 .35rem; }
  .more { margin-bottom: .8rem; }
  .tags { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .6rem; }
  .tags span { border: 1px solid var(--hairline-strong); border-radius: var(--radius-pill); padding: .2rem .55rem; color: var(--faded); font-size: .7rem; }
  .history-facts { display: flex; flex-wrap: wrap; gap: .6rem 1.5rem; margin-top: 1rem; color: var(--faded); font-size: .76rem; }
  .history-facts strong { color: var(--espresso); font-weight: 500; }
  header { display: flex; align-items: center; gap: 1rem; }
  .portrait { width: 80px; height: 80px; border-radius: 50%; flex-shrink: 0; }
  h2 { margin: .25rem 0 .5rem; color: var(--espresso); }
  h3 { font-size: .9rem; color: var(--espresso); margin: 1.5rem 0 1rem; }
  .kicker { color: var(--faded); font-size: .7rem; text-transform: uppercase; letter-spacing: .1em; }
  button { font: inherit; cursor: pointer; }
  .link { background: none; border: 0; color: var(--brick); padding: 0; font-size: .8rem; }
  .close { position: absolute; top: 1rem; right: 1rem; background: none; border: 0; color: var(--faded); font-size: 1.7rem; }
  .muted { color: var(--faded); font-size: .85rem; }
  .columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2rem; }
  .timeline { display: flex; align-items: flex-end; gap: 3px; }
  .timeline button { flex: 1 1 0; min-width: 0; max-width: 4rem; background: none; border: 0; padding: 0; color: var(--faded); font-size: .6rem; font-variant-numeric: tabular-nums; letter-spacing: -.02em; overflow: hidden; white-space: nowrap; }
  .bar-wrap { height: 70px; display: flex; align-items: flex-end; margin-bottom: .4rem; }
  .bar { width: 100%; background: var(--hairline-strong); border-radius: 3px 3px 0 0; }
  .chosen .bar, button:hover .bar { background: var(--brick); }
  @media (max-width: 1000px) { .overview { grid-template-columns: minmax(0, 1fr); gap: 1.5rem; } .columns { grid-template-columns: minmax(0, 1fr); gap: 0; } }
</style>
