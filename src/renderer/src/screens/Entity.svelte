<script lang="ts">
  import { isLastfmScrape, stripLastfmFooter } from '../../../shared/bio-text'
  import { plexState } from '../lib/plex-state.svelte'
  import { safeExternalHref } from '../../../shared/urls'
  import {
    compareAlbums,
    filterDeepCuts,
    groupAppearances,
    type EntitySort
  } from '../lib/entity-view'
  import UpcomingShowsCallout from '../lib/album-view/UpcomingShowsCallout.svelte'

  const entity = $derived(plexState.entityPage.entity)
  const loading = $derived(plexState.entityPage.loading)
  const error = $derived(plexState.entityPage.error)
  const browse = $derived(entity?.browse ?? null)
  const info = $derived(entity?.info ?? null)
  const albumsRaw = $derived(browse?.albums ?? [])
  const creditedRaw = $derived(plexState.entityPage.credited)
  const creditedLoading = $derived(plexState.entityPage.creditedLoading)
  const creditedError = $derived(plexState.entityPage.creditedError)
  const appearances = $derived(plexState.entityPage.appearances)

  // Grouping/sorting/filtering rules live in src/renderer/src/lib/entity-view.ts
  // (pure, unit-tested). These deriveds are thin bindings onto reactive state.
  const appearanceGroups = $derived(groupAppearances(appearances))
  const bio = $derived(plexState.entityPage.bio)
  const bioLoading = $derived(plexState.entityPage.bioLoading)

  // Default to "most played" — the differentiating sort. The user came to this
  // page wanting to see "what does this person play on that I actually listen
  // to?" Release order is available as a fallback for discography browsing.
  let sort = $state<EntitySort>('most-played')

  const albums = $derived([...albumsRaw].sort((a, b) => compareAlbums(a, b, sort)))
  const credited = $derived(
    creditedRaw
      ? {
          inLibrary: [...creditedRaw.inLibrary].sort((a, b) =>
            compareAlbums(a.album, b.album, sort)
          ),
          notInLibrary: creditedRaw.notInLibrary
        }
      : null
  )

  // "deep cuts": credited albums you own but haven't played in ~2y (or ever).
  // Surfacing rediscovery candidates for a long-tenured collector — the most
  // useful thing the credited-on data can do once a library passes a few
  // thousand albums.
  const deepCuts = $derived(credited ? filterDeepCuts(credited.inLibrary) : [])

  let bioExpanded = $state(false)
  let scrollY = $state(0)
  const condensedVisible = $derived(scrollY > 220)

  const plexArtistThumb = $derived(
    browse?.plexArtist?.thumb ? plexState.thumbUrl(browse.plexArtist.thumb, 600) : null
  )
  const heroImage = $derived(plexArtistThumb ?? bio?.image?.url ?? null)
  const heroImageSource = $derived<'plex' | 'wikipedia' | 'lastfm' | null>(
    plexArtistThumb ? 'plex' : bio?.image?.source ?? null
  )

  // Pick the richer of Plex's curated summary vs. our resolved bio (Last.fm /
  // Wikipedia). Without this, a Wikipedia one-line stub ("X is an American
  // band based in Y") arriving after Plex's longer summary would clobber the
  // page mid-load. Length is a decent proxy for "actually says something."
  // Plex's agent scrapes Last.fm artist blurbs (footer intact) into the
  // summary field — strip the footer BEFORE comparing so the CC-license
  // boilerplate doesn't tip the scales, and attribute scrapes to Last.fm.
  const chosenBio = $derived.by((): {
    text: string
    source: 'plex' | 'wikipedia' | 'lastfm'
    url: string | null
  } | null => {
    const fromBio = bio?.text?.trim() ?? ''
    const rawPlex = browse?.plexArtist?.summary?.trim() ?? ''
    const plexIsScrape = isLastfmScrape(rawPlex)
    const fromPlex = plexIsScrape ? stripLastfmFooter(rawPlex) : rawPlex
    const plexSource = plexIsScrape ? ('lastfm' as const) : ('plex' as const)
    // A winning scrape can still borrow our fetch's Last.fm URL for the
    // attribution link — same source, often the same text.
    const plexUrl = plexIsScrape && bio?.source === 'lastfm' ? bio?.url ?? null : null
    if (fromBio && fromPlex) {
      return fromPlex.length >= fromBio.length
        ? { text: fromPlex, source: plexSource, url: plexUrl }
        : { text: fromBio, source: bio!.source, url: bio?.url ?? null }
    }
    if (fromBio) return { text: fromBio, source: bio!.source, url: bio?.url ?? null }
    if (fromPlex) return { text: fromPlex, source: plexSource, url: plexUrl }
    return null
  })
  const bioText = $derived(chosenBio?.text ?? '')
  const bioNeedsTruncation = $derived(bioText.length > 720)
  // Cut on a word boundary — a mid-word "attainmen…" reads as a glitch.
  const visibleBio = $derived.by(() => {
    if (!bioNeedsTruncation || bioExpanded) return bioText
    const hard = bioText.slice(0, 720)
    const lastSpace = hard.lastIndexOf(' ')
    return (lastSpace > 600 ? hard.slice(0, lastSpace) : hard).trimEnd() + '…'
  })
  const bioSource = $derived<'plex' | 'wikipedia' | 'lastfm' | null>(chosenBio?.source ?? null)
  const bioUrl = $derived(chosenBio?.url ?? null)

  function back(): void {
    void plexState.goBack()
  }

  function openAlbum(ratingKey: string): void {
    void plexState.openAlbumDetail(ratingKey)
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') back()
  }

  function fmtYear(date: string | null): string {
    if (!date) return ''
    return date.slice(0, 4)
  }

  function onScroll(e: Event): void {
    scrollY = (e.currentTarget as HTMLElement).scrollTop
  }
</script>

<svelte:window onkeydown={onKey} />

<section onscroll={onScroll}>
  <header class="condensed" class:visible={condensedVisible}>
    <button class="back-mini" onclick={back} aria-label="Back" title="Back (Esc)">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    </button>
    {#if heroImage}
      <div class="cond-portrait"><img src={heroImage} alt="" /></div>
    {/if}
    {#if entity}
      <div class="cond-name">{entity.name}</div>
    {/if}
  </header>

  <div class="top-nav">
    <button class="back" onclick={back}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
      <span>back</span>
    </button>
  </div>

  {#if error && !entity}
    <p class="error">{error}</p>
  {:else if entity}
    <div class="hero" class:has-image={!!heroImage}>
      {#if heroImage}
        <div class="hero-bg" style="background-image: url('{heroImage}')"></div>
      {/if}
      <div class="hero-fade"></div>
      <div class="hero-content">
        {#if heroImage}
          <div class="hero-portrait">
            <img src={heroImage} alt={entity.name} />
          </div>
        {:else}
          <div class="hero-portrait fallback" aria-hidden="true">
            <span>{entity.name.slice(0, 1)}</span>
          </div>
        {/if}
        <div class="hero-meta">
          <div class="label">artist</div>
          <h1>{entity.name}</h1>
          <div class="meta">
            {#if info?.type}<span>{info.type}</span>{/if}
            {#if info?.origin}<span class="dot">·</span><span>{info.origin}</span>{/if}
            {#if info?.disambiguation}<span class="dot">·</span><span class="disambig">{info.disambiguation}</span>{/if}
          </div>
          {#if bio?.tags && bio.tags.length > 0}
            <div class="tags">
              {#each bio.tags.slice(0, 8) as tag (tag)}
                <span class="tag">{tag}</span>
              {/each}
            </div>
          {/if}
          <div class="hero-status">
            {#if loading && !browse}
              <span class="plex-pill loading"><span class="pulse"></span>loading your library…</span>
            {:else if browse?.plexArtist}
              <span class="plex-pill found"><span class="pulse on"></span>in your library as <strong>{browse.plexArtist.title}</strong></span>
            {:else if browse}
              <span class="plex-pill missing">not in your library as a primary artist</span>
            {/if}
          </div>
          <UpcomingShowsCallout artistName={entity.name} />
        </div>
      </div>
    </div>

    <div class="body">
      {#if bioText}
        {@const bioHref = safeExternalHref(bioUrl)}
        <div class="bio-block">
          <p class="bio">{visibleBio}</p>
          {#if bioNeedsTruncation}
            <button class="bio-toggle" onclick={() => (bioExpanded = !bioExpanded)}>
              {bioExpanded ? 'show less' : 'read more'}
            </button>
          {/if}
          <div class="bio-attr">
            {#if bioSource === 'wikipedia'}
              from {#if bioHref}<a href={bioHref} target="_blank" rel="noreferrer">Wikipedia</a>{:else}Wikipedia{/if} · CC BY-SA
            {:else if bioSource === 'lastfm'}
              from {#if bioHref}<a href={bioHref} target="_blank" rel="noreferrer">Last.fm</a>{:else}Last.fm{/if}
            {:else if bioSource === 'plex'}
              from Plex
            {/if}
            {#if heroImageSource && heroImageSource !== bioSource}
              <span class="attr-sep">·</span>
              image from {heroImageSource === 'plex' ? 'Plex' : heroImageSource === 'wikipedia' ? 'Wikipedia' : 'Last.fm'}
            {/if}
          </div>
        </div>
      {:else if bioLoading}
        <p class="hint">looking up a bio…</p>
      {/if}

      {#if albums.length + (credited?.inLibrary.length ?? 0) >= 1 || creditedLoading}
        <div class="sort-bar">
          <span class="sort-label">sort</span>
          <button
            class="sort-pill"
            class:active={sort === 'most-played'}
            onclick={() => (sort = 'most-played')}
          >most played</button>
          <button
            class="sort-pill"
            class:active={sort === 'release'}
            onclick={() => (sort = 'release')}
          >release order</button>
        </div>
      {/if}

      {#if albums.length > 0}
        <h2><span>albums on your server</span><span class="count">{albums.length}</span></h2>
        <ul class="grid">
          {#each albums as album (album.ratingKey)}
            {@const src = plexState.thumbUrl(album.thumb, 320, album.ratingKey)}
            <li>
              <button class="card" onclick={() => openAlbum(album.ratingKey)}>
                <div class="cover">
                  {#if src}
                    <img src={src} alt={album.title} loading="lazy" />
                  {:else}
                    <div class="cover-fallback">{album.title.slice(0, 1)}</div>
                  {/if}
                </div>
                <div class="title">{album.title}</div>
                <div class="artist">
                  {album.artist}{album.year ? ` · ${album.year}` : ''}
                </div>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if appearanceGroups.length > 0}
        <h2><span>your library credits</span><span class="count">{appearanceGroups.length} {appearanceGroups.length === 1 ? 'role' : 'roles'}</span></h2>
        <p class="hint deep-cuts-hint">grouped by role · drawn from album credits you've already opened</p>
        {#each appearanceGroups as g (g.label)}
          <div class="role-group">
            <h3 class="role-label">{g.label}<span class="role-count">{g.albums.length}</span></h3>
            <ul class="role-strip">
              {#each g.albums as a (a.ratingKey)}
                {@const src = plexState.thumbUrl(a.thumb, 200, a.ratingKey)}
                <li>
                  <button
                    class="role-card"
                    onclick={() => openAlbum(a.ratingKey)}
                    title={`${a.title} · ${a.artist}${a.year ? ` · ${a.year}` : ''}`}
                  >
                    {#if src}
                      <img src={src} alt={a.title} loading="lazy" />
                    {:else}
                      <div class="role-fallback">{a.title.slice(0, 1)}</div>
                    {/if}
                    <span class="role-card-title">{a.title}</span>
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      {/if}

      {#if creditedLoading && !credited}
        <p class="hint pulse-hint">
          <span class="dotpulse"></span>
          looking up credits on musicbrainz… <span class="hint-sub">can take ~30s for prolific artists</span>
        </p>
      {:else if creditedError}
        <p class="hint">credits lookup: {creditedError}</p>
      {:else if credited}
        {#if deepCuts.length > 0}
          <h2><span>deep cuts</span><span class="count">{deepCuts.length}</span></h2>
          <p class="hint deep-cuts-hint">credited on these but you haven't played them in a while</p>
          <ul class="grid">
            {#each deepCuts as entry (entry.album.ratingKey)}
              {@const src = plexState.thumbUrl(entry.album.thumb, 320, entry.album.ratingKey)}
              <li>
                <button class="card" onclick={() => openAlbum(entry.album.ratingKey)}>
                  <div class="cover">
                    {#if src}
                      <img src={src} alt={entry.album.title} loading="lazy" />
                    {:else}
                      <div class="cover-fallback">{entry.album.title.slice(0, 1)}</div>
                    {/if}
                  </div>
                  <div class="title">{entry.album.title}</div>
                  <div class="artist">
                    {entry.album.artist}{entry.album.year ? ` · ${entry.album.year}` : ''}
                  </div>
                  <div class="role-pills">
                    {#each entry.roles as r (r)}
                      <span class="role-pill">{r}</span>
                    {/each}
                  </div>
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        {#if credited.inLibrary.length > 0}
          <h2><span>credited on — in your library</span><span class="count">{credited.inLibrary.length}</span></h2>
          <ul class="grid">
            {#each credited.inLibrary as entry (entry.album.ratingKey)}
              {@const src = plexState.thumbUrl(entry.album.thumb, 320, entry.album.ratingKey)}
              <li>
                <button class="card" onclick={() => openAlbum(entry.album.ratingKey)}>
                  <div class="cover">
                    {#if src}
                      <img src={src} alt={entry.album.title} loading="lazy" />
                    {:else}
                      <div class="cover-fallback">{entry.album.title.slice(0, 1)}</div>
                    {/if}
                  </div>
                  <div class="title">{entry.album.title}</div>
                  <div class="artist">
                    {entry.album.artist}{entry.album.year ? ` · ${entry.album.year}` : ''}
                  </div>
                  <div class="role-pills">
                    {#each entry.roles as r (r)}
                      <span class="role-pill">{r}</span>
                    {/each}
                  </div>
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        {#if credited.notInLibrary.length > 0}
          <h2><span>credited on — not in your library</span><span class="count">{credited.notInLibrary.length}</span></h2>
          <ul class="external-list">
            {#each credited.notInLibrary as w (w.kind + ':' + w.mbid)}
              <li>
                <div class="ext-main">
                  <div class="ext-title">{w.title}</div>
                  <div class="ext-sub">
                    {fmtYear(w.date)}
                    {#if w.kind === 'release'}<span class="ext-tag">release</span>{:else}<span class="ext-tag">album</span>{/if}
                  </div>
                  <div class="role-pills">
                    {#each w.roles as r (r)}
                      <span class="role-pill">{r}</span>
                    {/each}
                  </div>
                </div>
                <a
                  class="ext-link"
                  href={`https://musicbrainz.org/${w.kind}/${w.mbid}`}
                  target="_blank"
                  rel="noreferrer"
                >mb ↗</a>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}

      {#if browse?.mbid}
        <p class="mb-link">
          <a href={`https://musicbrainz.org/artist/${browse.mbid}`} target="_blank" rel="noreferrer">
            view on musicbrainz ↗
          </a>
        </p>
      {/if}
    </div>
  {/if}
</section>

<style>
  section {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    background: var(--paper);
    position: relative;
  }

  /* condensed header on scroll */
  .condensed {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.65rem 1.5rem;
    background: rgba(10, 10, 13, 0.85);
    backdrop-filter: blur(20px) saturate(1.2);
    -webkit-backdrop-filter: blur(20px) saturate(1.2);
    border-bottom: 1px solid var(--ink-tint-04);
    transform: translateY(-100%);
    opacity: 0;
    transition: transform 220ms ease, opacity 180ms ease;
    -webkit-app-region: drag;
    pointer-events: none;
  }
  .condensed.visible {
    transform: translateY(0);
    opacity: 1;
    pointer-events: auto;
  }
  .back-mini {
    -webkit-app-region: no-drag;
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--ink-tint-06);
    color: var(--espresso);
    border: 1px solid var(--ink-tint-08);
    border-radius: var(--radius-pill);
    cursor: pointer;
    padding: 0;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .back-mini:hover { background: var(--ink-tint-12); border-color: var(--ink-tint-16); }
  .cond-portrait {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    box-shadow: 0 0 0 1px var(--ink-tint-08);
  }
  .cond-portrait img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cond-name {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--espresso);
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* full back button (within hero area) */
  .top-nav {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 5;
    padding: 1.1rem 1.5rem;
    -webkit-app-region: drag;
    pointer-events: none;
  }
  .back {
    -webkit-app-region: no-drag;
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: rgba(10, 10, 13, 0.55);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    color: var(--espresso);
    border: 1px solid var(--ink-tint-08);
    padding: 0.45rem 0.95rem 0.45rem 0.75rem;
    border-radius: var(--radius-pill);
    font-size: 0.82rem;
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease, transform 80ms ease;
  }
  .back:hover { background: rgba(30, 30, 36, 0.85); border-color: var(--ink-tint-16); }
  .back:active { transform: scale(0.97); }

  /* hero */
  .hero {
    position: relative;
    flex-shrink: 0;
    padding: 4.25rem 2.5rem 2rem;
    overflow: hidden;
    background: linear-gradient(180deg, #131317 0%, var(--paper) 100%);
    isolation: isolate;
  }
  .hero.has-image { background: var(--paper); }
  .hero-bg {
    position: absolute;
    inset: -60px;
    background-size: cover;
    background-position: center 25%;
    filter: blur(60px) saturate(1.3);
    opacity: 0.5;
    z-index: 0;
    transform: scale(1.1);
  }
  .hero-fade {
    position: absolute;
    inset: 0;
    z-index: 1;
    background:
      linear-gradient(180deg, rgba(10, 10, 13, 0.25) 0%, rgba(10, 10, 13, 0.55) 55%, var(--paper) 100%),
      radial-gradient(ellipse at 30% 20%, rgba(140, 53, 34, 0.06), transparent 55%),
      radial-gradient(ellipse at 80% 100%, rgba(120, 80, 200, 0.08), transparent 60%);
  }
  .hero-content {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: flex-end;
    gap: 2.25rem;
    max-width: 1280px;
    margin: 0 auto;
  }
  .hero-portrait {
    width: 220px;
    height: 220px;
    flex-shrink: 0;
    border-radius: 50%;
    overflow: hidden;
    box-shadow:
      0 24px 60px rgba(43, 29, 18, 0.3),
      0 0 0 1px var(--ink-tint-06),
      inset 0 0 0 4px var(--ink-tint-04);
    background: var(--surface);
  }
  .hero-portrait img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .hero-portrait.fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-tint-12);
    font-size: 6rem;
    font-weight: 700;
  }
  .hero-meta { min-width: 0; flex: 1; padding-bottom: 0.4rem; }
  .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--walnut);
    margin-bottom: 0.45rem;
    font-weight: 500;
  }
  h1 {
    font-size: clamp(2.4rem, 4.5vw, 3.75rem);
    font-weight: 800;
    letter-spacing: -0.035em;
    line-height: 1;
    margin: 0;
    text-shadow: 0 2px 28px rgba(43, 29, 18, 0.28);
    background: linear-gradient(180deg, var(--espresso) 0%, var(--walnut) 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
  }
  /* Sits over the blurred hero photo — needs full-strength ink plus a hint
     of shadow to stay legible on busy images. */
  .meta { color: var(--espresso); font-size: 0.92rem; margin-top: 0.85rem; display: flex; align-items: center; flex-wrap: wrap; text-shadow: 0 1px 8px color-mix(in srgb, var(--paper) 60%, transparent); }
  .meta .disambig { color: var(--walnut); font-style: italic; }
  .dot { margin: 0 0.5rem; color: var(--whisper); }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.95rem;
  }
  .tag {
    font-size: 0.7rem;
    color: var(--espresso);
    background: var(--ink-tint-06);
    border: 1px solid rgba(255, 255, 255, 0.09);
    padding: 0.22rem 0.65rem;
    border-radius: var(--radius-pill);
    text-transform: lowercase;
    letter-spacing: 0.02em;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  .hero-status { margin-top: 1rem; min-height: 22px; }
  .plex-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.75rem;
    padding: 0.28rem 0.75rem;
    border-radius: var(--radius-pill);
    border: 1px solid transparent;
  }
  .plex-pill.found {
    /* ok-fg, not ok-bg — the bg token as text washes out over the hero. */
    color: var(--ok-fg);
    background: rgba(74, 222, 128, 0.12);
    border-color: rgba(74, 222, 128, 0.28);
  }
  .plex-pill.found strong { color: var(--espresso); font-weight: 600; margin-left: 0.15rem; }
  .plex-pill.missing {
    color: var(--faded);
    background: rgba(255, 255, 255, 0.03);
    border-color: var(--ink-tint-06);
  }
  .plex-pill.loading {
    color: var(--walnut);
    background: rgba(255, 255, 255, 0.03);
    border-color: var(--ink-tint-06);
  }
  .pulse {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--faded);
  }
  .pulse.on {
    background: var(--ok-fg);
    box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.6);
    animation: pulse 1.6s ease-out infinite;
  }
  @keyframes pulse {
    0%   { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.55); }
    70%  { box-shadow: 0 0 0 8px rgba(74, 222, 128, 0); }
    100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
  }

  /* body */
  .body { flex-shrink: 0; padding: 1.75rem 2.5rem 4rem; max-width: 1280px; margin: 0 auto; width: 100%; box-sizing: border-box; }
  .bio-block {
    margin-bottom: 2.5rem;
    max-width: 72ch;
  }
  .bio {
    color: var(--walnut);
    font-size: 1rem;
    line-height: 1.7;
    margin: 0;
    white-space: pre-wrap;
  }
  .bio-toggle {
    margin-top: 0.65rem;
    background: transparent;
    border: 0;
    color: var(--brick);
    padding: 0;
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
    border-bottom: 1px solid transparent;
  }
  .bio-toggle:hover { border-bottom-color: var(--brick); }
  .bio-attr {
    margin-top: 0.95rem;
    font-size: 0.75rem;
    color: var(--faded);
  }
  .bio-attr a {
    color: var(--faded);
    text-decoration: none;
    border-bottom: 1px dotted var(--hairline);
  }
  .bio-attr a:hover { color: var(--brick); border-bottom-color: var(--brick); }
  .attr-sep { margin: 0 0.4rem; color: var(--whisper); }

  .sort-bar {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0 0 1.4rem;
  }
  .sort-label {
    font-size: 0.68rem;
    color: var(--faded);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-right: 0.3rem;
  }
  .sort-pill {
    background: var(--ink-tint-04);
    color: var(--walnut);
    border: 1px solid var(--ink-tint-06);
    padding: 0.32rem 0.75rem;
    border-radius: var(--radius-pill);
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  .sort-pill:hover { background: var(--ink-tint-08); color: var(--espresso); }
  .sort-pill.active {
    background: var(--brick);
    color: var(--inset);
    border-color: var(--brick);
  }

  h2 {
    font-size: 1.05rem;
    font-weight: 600;
    margin: 2.25rem 0 1.1rem;
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    color: var(--espresso);
    letter-spacing: -0.005em;
  }
  h2 .count {
    font-size: 0.72rem;
    color: var(--faded);
    background: var(--ink-tint-04);
    border: 1px solid var(--ink-tint-06);
    padding: 0.1rem 0.5rem;
    border-radius: var(--radius-pill);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
    gap: 1.5rem 1.1rem;
  }
  .grid li { min-width: 0; }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    width: 100%;
    padding: 0;
    background: transparent;
    border: 0;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font: inherit;
    transition: transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .card:hover { transform: translateY(-3px); }
  .card:focus-visible { outline: 2px solid var(--brick); outline-offset: 4px; border-radius: var(--radius-lg); }
  .cover {
    aspect-ratio: 1 / 1;
    background: var(--surface);
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: 0 6px 18px rgba(43, 29, 18, 0.22);
    transition: box-shadow 220ms ease;
  }
  .card:hover .cover {
    box-shadow:
      0 14px 32px rgba(43, 29, 18, 0.28),
      0 0 0 1px var(--ink-tint-04);
  }
  .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cover-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--whisper);
    font-size: 3rem;
    font-weight: 700;
  }
  .title {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--espresso);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-clamp: 2;
    overflow: hidden;
    word-break: break-word;
    line-height: 1.25;
  }
  .artist {
    font-size: 0.78rem;
    color: var(--faded);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-clamp: 2;
    overflow: hidden;
    word-break: break-word;
    line-height: 1.25;
  }
  .mb-link { margin-top: 2rem; font-size: 0.82rem; }
  .mb-link a { color: var(--brick); text-decoration: none; border-bottom: 1px solid transparent; }
  .mb-link a:hover { border-bottom-color: var(--brick); }
  .hint { color: var(--faded); padding: 1rem 0; font-size: 0.88rem; display: inline-flex; align-items: center; gap: 0.55rem; }
  .deep-cuts-hint { padding: 0 0 0.6rem; font-style: italic; }
  .role-group { margin: 0.5rem 0 1.2rem; }
  .role-label {
    margin: 0 0 0.45rem;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--walnut);
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .role-count {
    font-size: 0.7rem;
    color: var(--faded);
    background: var(--surface);
    padding: 0.05rem 0.45rem;
    border-radius: var(--radius-pill);
    font-weight: 500;
    letter-spacing: 0;
  }
  .role-strip {
    list-style: none;
    margin: 0;
    padding: 0 0 0.3rem;
    display: flex;
    gap: 0.6rem;
    overflow-x: auto;
    scrollbar-width: thin;
  }
  .role-strip li { flex: 0 0 auto; }
  .role-card {
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    width: 92px;
    color: inherit;
    font: inherit;
  }
  .role-card img,
  .role-fallback {
    width: 92px;
    height: 92px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    background: var(--surface-deep);
    display: block;
    box-shadow: 0 4px 10px rgba(43, 29, 18, 0.18);
    transition: transform var(--dur-base) var(--ease-spring), box-shadow var(--dur-base) var(--ease-out);
  }
  .role-card:hover img,
  .role-card:hover .role-fallback {
    transform: translateY(-4px);
    box-shadow: 0 10px 22px rgba(43, 29, 18, 0.28);
  }
  .role-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--whisper);
    font-size: 1.4rem;
    font-weight: 700;
  }
  .role-card-title {
    font-size: 0.7rem;
    color: var(--walnut);
    width: 92px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }
  .hint-sub { color: var(--faded); font-size: 0.78rem; }
  .pulse-hint {
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid var(--ink-tint-04);
    border-radius: var(--radius-xl);
    padding: 0.7rem 1rem;
  }
  .dotpulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--brick);
    box-shadow: 0 0 8px rgba(140, 53, 34, 0.5);
    animation: dotbreath 1.4s ease-in-out infinite;
    flex-shrink: 0;
  }
  @keyframes dotbreath {
    0%, 100% { opacity: 0.4; transform: scale(0.85); }
    50%      { opacity: 1;   transform: scale(1.05); }
  }
  .error { color: var(--err-fg); padding: 2rem; }

  .role-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.4rem;
  }
  .role-pill {
    font-size: 0.68rem;
    color: var(--brick);
    background: var(--brick-wash);
    border: 1px solid rgba(140, 53, 34, 0.22);
    padding: 0.1rem 0.5rem;
    border-radius: var(--radius-pill);
    text-transform: lowercase;
    letter-spacing: 0.02em;
  }
  .external-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.6rem;
  }
  .external-list li {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid var(--ink-tint-04);
    border-radius: var(--radius-xl);
    padding: 0.8rem 0.9rem;
    transition: border-color 140ms ease, background 140ms ease;
  }
  .external-list li:hover {
    border-color: rgba(43, 29, 18, 0.1);
    background: var(--ink-tint-04);
  }
  .ext-main { min-width: 0; flex: 1; }
  .ext-title {
    font-size: 0.92rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--espresso);
  }
  .ext-sub {
    font-size: 0.74rem;
    color: var(--faded);
    margin-top: 0.2rem;
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .ext-tag {
    font-size: 0.62rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--faded);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: 0.05rem 0.35rem;
  }
  .ext-link {
    color: var(--faded);
    text-decoration: none;
    font-size: 0.75rem;
    flex-shrink: 0;
    padding: 0.3rem 0.5rem;
    border-radius: var(--radius-md);
    transition: color 120ms ease, background 120ms ease;
  }
  .ext-link:hover { color: var(--brick); background: var(--brick-wash); }

  @media (max-width: 780px) {
    .hero { padding: 5rem 1.5rem 2rem; }
    .hero-content { flex-direction: column; align-items: flex-start; gap: 1.5rem; }
    .hero-portrait { width: 160px; height: 160px; }
    .body { padding: 1.5rem 1.5rem 3rem; }
  }
</style>
