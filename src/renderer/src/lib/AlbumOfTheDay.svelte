<script lang="ts">
  import { onMount } from 'svelte'
  import type { Bio } from '../../../shared/plex'
  import { plexState } from './plex-state.svelte'
  import { queueMenuItems } from './queue-menu'
  import { splitAlbumMbids } from '../../../shared/guid'
  import { isCuratedPlexSummary, pickMoreCompleteBio } from '../../../shared/bio-text'

  const album = $derived(plexState.albumOfTheDay.album)
  const cover = $derived(album ? plexState.thumbUrl(album.thumb, 600) : null)
  const label = $derived(album ? (plexState.labelIndex.labels[album.ratingKey]?.[0] ?? null) : null)
  const canCast = $derived(!!plexState.playback.activePlayerId)
  let castBusy = $state(false)
  let plexSummary = $state<string | null>(null)
  let bio = $state<Bio | null>(null)
  let blurbLoading = $state(false)
  let blurbForRatingKey: string | null = null

  const blurbText = $derived(
    plexSummary && plexSummary.trim() ? plexSummary.trim() : (bio?.text?.trim() ?? null)
  )

  let bioTextEl = $state<HTMLDivElement | null>(null)
  let bioOverflows = $state(false)

  $effect(() => {
    if (!bioTextEl) {
      bioOverflows = false
      return
    }
    // Re-measure when blurbText changes (touch the dep) or the element resizes.
    void blurbText
    const measure = (): void => {
      if (!bioTextEl) return
      bioOverflows = bioTextEl.scrollHeight > bioTextEl.clientHeight + 1
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(bioTextEl)
    return () => ro.disconnect()
  })
  const blurbSource = $derived(
    plexSummary && plexSummary.trim() ? null : (bio?.source ?? null)
  )
  const blurbUrl = $derived(plexSummary && plexSummary.trim() ? null : (bio?.url ?? null))

  onMount(() => {
    void plexState.albumOfTheDay.load()
  })

  $effect(() => {
    const a = album
    if (!a) return
    if (blurbForRatingKey === a.ratingKey) return
    blurbForRatingKey = a.ratingKey
    void loadBlurb(a.ratingKey, a.guids, a.artist, a.title)
  })

  async function loadBlurb(
    rk: string,
    guids: string[],
    artist: string,
    title: string
  ): Promise<void> {
    plexSummary = null
    bio = null
    blurbLoading = true
    try {
      // Plex's own summary is the long-form AllMusic-style review when present;
      // it's far better than the Wikipedia/last.fm fallback. Fetch the album
      // detail first and only fall back to the bio if Plex has nothing curated —
      // a Last.fm scrape in the summary field doesn't count (our own fetch gets
      // the full text; the stripped scrape is just the floor).
      const serverId = plexState.session?.signedIn
        ? plexState.session.preferredServerId
        : null
      if (!serverId) return
      const detail = await window.cratedigger.plex.getAlbumDetail({ serverId, ratingKey: rk })
      if (plexState.albumOfTheDay.album?.ratingKey !== rk) return
      if (isCuratedPlexSummary(detail.summary)) {
        plexSummary = detail.summary
        return
      }
      const { release: releaseMbid, releaseGroup: releaseGroupMbid } = splitAlbumMbids(guids)
      const result = await window.cratedigger.plex.getAlbumBio({
        releaseMbid,
        releaseGroupMbid,
        artist,
        title
      })
      if (plexState.albumOfTheDay.album?.ratingKey === rk) {
        bio = pickMoreCompleteBio(result, detail.summary)
      }
    } catch {
      // optional enrichment — stay silent
    } finally {
      blurbLoading = false
    }
  }

  async function playAlbum(): Promise<void> {
    if (!album || castBusy) return
    castBusy = true
    try {
      await plexState.playback.requestCastAlbum(album.ratingKey, album.title, album.artist)
    } finally {
      castBusy = false
    }
  }

  function open(): void {
    if (album) void plexState.openAlbumDetail(album.ratingKey)
  }

  function ctxMenu(e: MouseEvent): void {
    if (!album) return
    e.preventDefault()
    plexState.openContextMenu(e.clientX, e.clientY, [
      {
        label: 'Play Now',
        onClick: () => void plexState.playback.requestCastAlbum(album.ratingKey, album.title, album.artist)
      },
      ...queueMenuItems('album', album.ratingKey, album.title, album.artist)
    ])
  }
</script>

{#if album}
  <section class="card">
    <div class="cover-wrap">
      <button class="cover" onclick={open} oncontextmenu={ctxMenu} aria-label={`open ${album.title}`}>
        {#if cover}
          <img src={cover} alt={album.title} />
        {:else}
          <div class="fallback">{album.title.slice(0, 1)}</div>
        {/if}
      </button>
    </div>
    <div class="meta">
      <div class="kicker">album of the day</div>
      <button class="title" onclick={open}>{album.title}</button>
      <div class="sub">
        {album.artist}{album.year ? ` · ${album.year}` : ''}{label ? ` · ${label}` : ''}
      </div>
      {#if album.genres.length > 0}
        <div class="genres">
          {#each album.genres.slice(0, 4) as g (g)}
            <button class="genre-pill" onclick={() => plexState.openGenreEntity(g)}>{g}</button>
          {/each}
        </div>
      {/if}
      <div class="actions">
        <button class="play" onclick={playAlbum} disabled={!canCast || castBusy}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
            <polygon points="6 4 20 12 6 20 6 4"></polygon>
          </svg>
          <span>{castBusy ? 'Sending…' : !canCast ? 'Pick a player' : 'Play Album'}</span>
        </button>
        <button class="open" onclick={open}>Open</button>
      </div>
    </div>
    <aside class="bio">
      {#if blurbText}
        <div class="bio-text" class:overflowing={bioOverflows} bind:this={bioTextEl}>{blurbText}</div>
        {#if blurbUrl}
          <a class="bio-source" href={blurbUrl} target="_blank" rel="noreferrer noopener">
            via {blurbSource ?? 'last.fm'}
          </a>
        {/if}
      {:else if blurbLoading}
        <div class="bio-placeholder">loading notes…</div>
      {/if}
    </aside>
  </section>
{/if}

<style>
  .card {
    display: grid;
    grid-template-columns: minmax(220px, 280px) minmax(260px, 380px) 1fr;
    gap: 1.6rem;
    padding: 1.6rem 1.8rem;
    margin: 0 0 1.6rem;
    background: var(--paper);
    background-image:
      radial-gradient(rgba(43, 29, 18, 0.025) 1px, transparent 1px),
      linear-gradient(180deg, var(--surface), var(--paper));
    background-size: 4px 4px, auto;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    box-shadow: 0 18px 40px rgba(43, 29, 18, 0.18), inset 0 0 0 1px rgba(43, 29, 18, 0.4);
  }
  @media (max-width: 980px) {
    .card { grid-template-columns: minmax(220px, 280px) 1fr; }
    .bio { display: none; }
  }
  .cover-wrap { min-width: 0; }
  .cover {
    aspect-ratio: 1 / 1;
    width: 100%;
    background: var(--surface-deep);
    border: 0;
    padding: 0;
    border-radius: var(--radius-sm);
    overflow: hidden;
    cursor: pointer;
    box-shadow: 0 14px 32px rgba(43, 29, 18, 0.32);
    transition: transform 240ms ease, box-shadow 240ms ease;
  }
  .cover:hover {
    transform: translateY(-3px);
    box-shadow: 0 22px 44px rgba(43, 29, 18, 0.42);
  }
  .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--faded);
    font-size: 4rem;
    font-weight: 700;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
    align-self: center;
  }
  .kicker {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--brick);
    font-weight: 700;
  }
  .title {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--espresso);
    text-align: left;
    font-family: var(--font-display);
    font-size: 2.2rem;
    font-weight: 600;
    line-height: 1.05;
    letter-spacing: -0.01em;
    cursor: pointer;
    border-bottom: 1px solid transparent;
    align-self: flex-start;
  }
  .title:hover { border-bottom-color: var(--walnut); }
  .sub { color: var(--walnut); font-size: 0.95rem; }
  .genres { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.2rem; }
  .genre-pill {
    background: rgba(43, 29, 18, 0.05);
    border: 1px solid var(--hairline);
    color: var(--walnut);
    padding: 0.2rem 0.65rem;
    border-radius: var(--radius-pill);
    font-size: 0.75rem;
    cursor: pointer;
    transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
  }
  .genre-pill:hover {
    color: var(--brick-deep);
    border-color: var(--brick);
    background: var(--brick-wash);
  }
  .actions { display: flex; gap: 0.6rem; margin-top: 0.8rem; }
  .play {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--brick);
    color: var(--inset);
    border: 0;
    padding: 0.55rem 1.1rem;
    border-radius: var(--radius-pill);
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform 120ms ease, background 120ms ease;
  }
  .play:not(:disabled):hover { background: var(--brick-deep); transform: translateY(-1px); }
  .play:disabled { background: rgba(140, 53, 34, 0.4); color: var(--inset); cursor: not-allowed; }
  .open {
    background: transparent;
    color: var(--walnut);
    border: 1px solid var(--hairline);
    padding: 0.55rem 1.1rem;
    border-radius: var(--radius-pill);
    font-size: 0.9rem;
    cursor: pointer;
    transition: border-color 120ms ease, color 120ms ease;
  }
  .open:hover { color: var(--espresso); border-color: var(--walnut); }
  .bio {
    min-width: 0;
    align-self: stretch;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding-left: 1.6rem;
    border-left: 1px solid var(--hairline);
    overflow: hidden;
  }
  .bio-text {
    color: var(--espresso);
    font-family: var(--font-display);
    font-size: 0.92rem;
    line-height: 1.6;
    max-height: 17em;
    overflow: hidden;
    white-space: pre-wrap;
  }
  .bio-text.overflowing {
    -webkit-mask-image: linear-gradient(180deg, #000 80%, transparent 100%);
    mask-image: linear-gradient(180deg, #000 80%, transparent 100%);
  }
  .bio-source {
    color: var(--faded);
    font-size: 0.72rem;
    text-decoration: none;
    align-self: flex-start;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .bio-source:hover { color: var(--brick); text-decoration: underline; }
  .bio-placeholder {
    color: var(--faded);
    font-size: 0.8rem;
    font-style: italic;
  }
</style>
