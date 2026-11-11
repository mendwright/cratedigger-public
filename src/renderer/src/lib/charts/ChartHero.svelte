<script lang="ts">
  // The #1 spot: a 2×2 tile at the head of ChartRanking's card grid. The
  // band's photo fills it, their most-played record sits in the corner, and
  // the name, numbers and a couple of bio lines run over the bottom.
  import type { ChartEntry, ChartDimension } from '../../../../shared/charts'
  import { formatListened } from '../../../../shared/charts'
  import { plexState } from '../plex-state.svelte'
  import ChartArt from './ChartArt.svelte'
  import { stripLastfmFooter } from '../../../../shared/bio-text'
  import { PUBLIC_BUILD } from '../../../../shared/build-flags'

  let {
    entry,
    dimension,
    onopen,
    onplay
  }: {
    entry: ChartEntry
    dimension: ChartDimension
    onopen: (e: ChartEntry) => void
    onplay: (e: ChartEntry) => void
  } = $props()

  const c = $derived(plexState.charts)
  const artistName = $derived(dimension === 'artists' ? entry.title : (entry.subtitle ?? ''))
  const kind = $derived(dimension === 'artists' ? 'artist' : dimension === 'albums' ? 'album' : 'track')

  // Photos only: the Plex artist picture and the Wikipedia/Wikidata one.
  // Album covers are left out on purpose so the photo never repeats a sleeve.
  let photoUrls = $state<string[]>([])
  let photoFailed = $state<string[]>([])
  const photo = $derived(photoUrls.find((u) => !photoFailed.includes(u)) ?? null)

  // Artist chart: their most-played album in this window, for the corner.
  let topAlbum = $state<ChartEntry | null>(null)

  $effect(() => {
    const name = artistName
    const snap = $state.snapshot(entry)
    const dim = dimension
    photoUrls = []
    photoFailed = []
    topAlbum = null
    if (!name) return
    let live = true
    // Plex's artist picture goes LAST: it's often just an album cover
    // (Phoebe Bridgers = Stranger in the Alps), which would sit next to
    // another of her sleeves. Real photos (Wikipedia, Deezer) win.
    const plexPhoto = dim === 'artists' && snap.thumb ? plexState.thumbUrl(snap.thumb, 900) : null
    const probe: ChartEntry = { rank: 0, title: name, subtitle: null, plays: 0, seconds: 0, ratingKey: dim === 'artists' ? snap.ratingKey : null, thumb: null }
    void window.cratedigger.charts
      .art(probe, 'artists')
      .then((urls) => {
        if (!live) return
        const web = urls.filter((u) => /^https?:/i.test(u))
        photoUrls = [...web, ...(plexPhoto ? [plexPhoto] : [])]
      })
      .catch(() => {
        if (live && plexPhoto) photoUrls = [plexPhoto]
      })

    if (dim === 'artists') {
      const req =
        c.tab === 'household'
          ? window.cratedigger.charts
              .top({ userIds: [...c.selected], window: c.window, dimension: 'albums', artist: name, limit: 1 })
              .then((r) => r.entries)
          : window.cratedigger.history.top({ dimension: 'albums', artist: name, ...c.bounds, limit: 1 })
      void Promise.resolve(req)
        .then((list) => {
          if (live) topAlbum = list?.[0] ?? null
        })
        .catch(() => {})
    }
    return () => {
      live = false
    }
  })

  // A few lines about them, so the #1 spot says who this is, not just a count.
  // Artist chart → the artist's bio; album chart → the album's, falling back
  // to the artist's. Both are disk-cached in main (bios.ts).
  let bio = $state<{ text: string; tags: string[] } | null>(null)
  $effect(() => {
    const name = artistName
    const title = entry.title
    const dim = dimension
    bio = null
    if (!name) return
    let live = true
    const plex = window.cratedigger.plex
    const clean = (t: string | null | undefined): string => stripLastfmFooter(t ?? '').split(/\n\s*\n/)[0]?.trim() ?? ''
    void (async () => {
      try {
        if (dim === 'albums') {
          const a = await plex.getAlbumBio({ releaseMbid: null, releaseGroupMbid: null, artist: name, title })
          const text = clean(a?.text)
          if (live && text.length > 80) {
            bio = { text, tags: [] }
            return
          }
        }
        const mbid = await plex.searchArtistByName({ name })
        if (!mbid || !live) return
        const a = await plex.getArtistBio({ mbid, name })
        if (live && a) bio = { text: clean(a.text), tags: (a.tags ?? []).slice(0, 5) }
      } catch {
        /* no bio is fine */
      }
    })()
    return () => {
      live = false
    }
  })

  function grabRecord(r: ChartEntry): void {
    const artist = r.subtitle ?? artistName
    if (!artist) return
    if (dimension === 'tracks') void plexState.findGapAlbumOnSlskd(artist, r.title, r.album ?? null)
    else void plexState.findGapOnSlskd(artist, r.title)
  }

  // The headline record: the artist's most-played album, or the #1 album itself.
  const record = $derived(dimension === 'artists' ? topAlbum : entry)
</script>

{#snippet stats()}
  <div class="stats"><strong>{formatListened(entry.seconds)}</strong><span>{entry.plays.toLocaleString()} plays</span></div>
{/snippet}

{#snippet copy()}
  <div class="copy">
    <span class="eyebrow">#{entry.rank} · {entry.rank === 1 ? `most listened ${kind}` : `your most-played ${kind} not in the library`}</span>
    <button class="title" onclick={() => onopen(entry)}>{entry.title}</button>
    {#if entry.subtitle}<button class="sub" onclick={() => plexState.openArtistByName(entry.subtitle!, {})}>{entry.subtitle}</button>{/if}
    {@render stats()}
    {#if dimension === 'artists' && record}
      <p class="most">most played: <button onclick={() => record.ratingKey && plexState.openAlbumDetail(record.ratingKey)}>{record.title}</button></p>
    {/if}
    {#if bio?.text}
      <p class="bio">{bio.text}</p>
      <button class="more" onclick={() => plexState.openArtistByName(artistName, { plexRatingKey: dimension === 'artists' ? entry.ratingKey : undefined })}>more about {artistName} →</button>
    {/if}
    {#if bio?.tags.length}
      <div class="tags">{#each bio.tags as t (t)}<span>{t}</span>{/each}</div>
    {/if}
  </div>
{/snippet}

{#snippet photoImg(cls: string)}
  {#if photo}
    <img class={cls} src={photo} alt="" decoding="async" onerror={() => (photoFailed = [...photoFailed, photo!])} />
  {/if}
{/snippet}

{#snippet sleeveArt(e: ChartEntry)}
  <div class="sleeve-art"><ChartArt entry={e} dimension="albums" eager /></div>
{/snippet}

{#snippet playBtn()}
  {#if record?.ratingKey && dimension !== 'tracks'}
    <button class="play" onclick={() => onplay(record)} title="Play {record.title}" aria-label="Play {record.title}">▶</button>
  {:else if record && !record.ratingKey && !PUBLIC_BUILD}
    <button class="play grab" onclick={() => grabRecord(record)} title="Not in your library — search Soulseek" aria-label="Search Soulseek for {record.title}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>
    </button>
  {/if}
{/snippet}

<article class="hero tile">
    <button class="tile-art" onclick={() => onopen(entry)} aria-label="Explore {entry.title}">
      {#if photo}{@render photoImg('fill')}{:else}<ChartArt {entry} {dimension} eager />{/if}
    </button>
    <div class="tile-scrim" aria-hidden="true"></div>
    {#if record && photo}
      <div class="tile-record">{@render sleeveArt(record)}{@render playBtn()}</div>
    {/if}
    <div class="tile-copy">{@render copy()}</div>
  </article>

<style>
  button { font: inherit; color: inherit; cursor: pointer; background: none; border: 0; padding: 0; text-align: left; }
  .hero { position: relative; border-radius: 12px; }
  .fill { width: 100%; height: 100%; object-fit: cover; display: block; }

  /* shared copy */
  .copy { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; gap: 0.35rem; }
  .eyebrow { color: var(--faded); text-transform: uppercase; letter-spacing: 0.13em; font-size: 0.7rem; }
  .title { font-size: clamp(1.5rem, 2.6vw, 2.4rem); font-weight: 650; line-height: 1.08; letter-spacing: -0.03em; color: var(--espresso); overflow-wrap: anywhere; }
  .title:hover, .sub:hover, .most button:hover { color: var(--brick); }
  .sub { color: var(--walnut); font-size: 1.05rem; }
  .stats { display: flex; align-items: baseline; gap: 0.9rem; color: var(--faded); margin-top: 0.4rem; }
  .stats strong { color: var(--espresso); font-size: 1.4rem; font-variant-numeric: tabular-nums; }
  .most { margin: 0.5rem 0 0; color: var(--faded); font-size: 0.85rem; }
  .most button { color: var(--espresso); font-style: italic; }
  .bio { margin: 1rem 0 0; max-width: 62ch; color: var(--walnut); font-size: 0.92rem; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 5; line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
  .more { margin-top: 0.4rem; color: var(--brick); font-size: 0.8rem; }
  .more:hover { text-decoration: underline; }
  .tags { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.8rem; }
  .tags span { border: 1px solid var(--hairline-strong); border-radius: var(--radius-pill); padding: 0.15rem 0.6rem; font-size: 0.7rem; color: var(--faded); text-transform: lowercase; }
  .tile .bio { -webkit-line-clamp: 2; line-clamp: 2; color: rgba(255, 255, 255, 0.8); font-size: 0.82rem; }
  .tile .more { color: #fff; }
  .tile .tags { display: none; }

  .sleeve-art { width: 100%; aspect-ratio: 1; border-radius: 4px; overflow: hidden; box-shadow: 0 6px 22px rgba(var(--shadow-color), 0.35); }
  .play { position: absolute; right: 0.6rem; bottom: 0.6rem; background: var(--brick); color: var(--on-brick); border-radius: 50%; width: 2.6rem; height: 2.6rem; text-align: center; opacity: 0; transition: opacity 120ms; box-shadow: 0 2px 8px rgba(var(--shadow-color), 0.3); z-index: 2; }
  .hero:hover .play, .play:focus-visible { opacity: 1; }
  .grab { display: grid; place-items: center; background: color-mix(in srgb, var(--espresso) 85%, transparent); color: var(--surface); }
  .grab svg { width: 50%; height: 50%; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; }
  @media (hover: none) { .play { opacity: 1; } }


  /* tile spans 2×2 inside ChartRanking's grid */
  .tile { grid-column: span 2; grid-row: span 2; overflow: hidden; min-height: 100%; aspect-ratio: auto; }
  .tile-art { position: absolute; inset: 0; display: block; }
  .tile-art :global(.image) { border-radius: 0; }
  .tile-scrim { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(0deg, rgba(0, 0, 0, 0.82) 0%, rgba(0, 0, 0, 0.35) 40%, transparent 65%); }
  .tile-record { position: absolute; right: 1.2rem; bottom: 1.2rem; width: 30%; z-index: 2; }
  .tile-copy { position: absolute; left: 1.4rem; bottom: 1.3rem; right: 38%; z-index: 2; pointer-events: none; }
  .tile-copy :global(button) { pointer-events: auto; }
  .tile .eyebrow, .tile .stats, .tile .most { color: rgba(255, 255, 255, 0.75); }
  .tile .title, .tile .stats strong, .tile .most button { color: #fff; }
  .tile .sub { color: rgba(255, 255, 255, 0.85); }

</style>
