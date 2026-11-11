<script lang="ts">
  import { plexState } from '../lib/plex-state.svelte'
  import AlbumCard from '../lib/AlbumCard.svelte'
  import { labelMissingFromLibrary, type LabelMissingRelease } from '../lib/entity-view'
  import { PUBLIC_BUILD } from '../../../shared/build-flags'

  interface Props {
    name: string
  }
  const { name }: Props = $props()

  const albums = $derived(plexState.filterLibraryByLabel(name))
  const allAlbums = $derived(plexState.allAlbums)
  const allAlbumsLoading = $derived(plexState.allAlbumsLoading)

  // The label's MB catalog diffed against the library — same idea as the
  // artist page's "not on your server" section, per-label. Loaded per name;
  // the guard drops a stale response if the user hops labels mid-fetch.
  let missing = $state<LabelMissingRelease[] | null>(null)
  let missingLoading = $state(false)
  let missingTruncated = $state(false)
  let missingCoverFailed = $state<Record<string, true>>({})

  $effect(() => {
    const forName = name
    missing = null
    missingTruncated = false
    missingCoverFailed = {}
    missingLoading = true
    void (async () => {
      try {
        const [disco, library] = await Promise.all([
          window.cratedigger.plex.getLabelDiscography({ name: forName }),
          plexState.ensureAllAlbumsLoaded()
        ])
        if (name !== forName) return
        if (disco) {
          missing = labelMissingFromLibrary(disco.groups, library)
          missingTruncated = disco.truncated
        } else {
          missing = []
        }
      } catch {
        if (name === forName) missing = []
      } finally {
        if (name === forName) missingLoading = false
      }
    })()
  })

  function onMissingClick(m: LabelMissingRelease): void {
    if (PUBLIC_BUILD) {
      window.open(`https://musicbrainz.org/release-group/${m.mbid}`, '_blank')
      return
    }
    void plexState.openSlskd()
    void plexState.slskd.runSearch(m.artist, m.title)
  }

  function back(): void {
    void plexState.goBack()
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') back()
  }
</script>

<svelte:window onkeydown={onKey} />

<section>
  <button class="back" onclick={back} aria-label="Back" title="Back (Esc)">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12"></line>
      <polyline points="12 19 5 12 12 5"></polyline>
    </svg>
  </button>

  <header>
    <div class="eyebrow">label</div>
    <h1>{name}</h1>
    <div class="meta">
      {#if allAlbumsLoading && !allAlbums}
        loading library…
      {:else}
        {albums.length.toLocaleString()} album{albums.length === 1 ? '' : 's'} in your library
      {/if}
    </div>
  </header>

  {#if albums.length > 0}
    <ul class="grid" data-grid="albums">
      {#each albums as a (a.ratingKey)}
        <li><AlbumCard album={a} /></li>
      {/each}
    </ul>
  {:else if !allAlbumsLoading}
    <p class="empty">nothing matched.</p>
  {/if}

  {#if missing && missing.length > 0}
    <h2 class="section"><span>from the label — not in your library</span><span class="count">{missing.length}</span></h2>
    <p class="hint">
      {PUBLIC_BUILD ? 'from the musicbrainz catalog — click to view' : 'from the musicbrainz catalog · click one to search soulseek'}{missingTruncated ? ' · big catalog, showing the first stretch' : ''}
    </p>
    <ul class="grid">
      {#each missing as m (m.mbid)}
        <li>
          <button class="card" onclick={() => onMissingClick(m)} title={`${m.artist} — ${m.title}`}>
            <div class="cover missing-cover">
              {#if missingCoverFailed[m.mbid]}
                <div class="cover-fallback">{m.title.slice(0, 1)}</div>
              {:else}
                <img
                  src={`https://coverartarchive.org/release-group/${m.mbid}/front-250`}
                  alt={m.title}
                  loading="lazy"
                  onerror={() => (missingCoverFailed = { ...missingCoverFailed, [m.mbid]: true })}
                />
              {/if}
              <span class="missing-action">{PUBLIC_BUILD ? 'view on mb ↗' : 'search soulseek'}</span>
            </div>
            <div class="title">{m.title}</div>
            <div class="artist">{m.artist}</div>
            <div class="year">{m.year ?? 'date unknown'}{m.primaryType === 'EP' ? ' · EP' : ''}</div>
          </button>
        </li>
      {/each}
    </ul>
  {:else if missingLoading}
    <p class="hint pulse-hint">checking the label's catalog for gaps…</p>
  {/if}
</section>

<style>
  section {
    height: 100%;
    box-sizing: border-box;
    padding: 1.2rem 2rem 2rem;
    overflow-y: auto;
    background:
      radial-gradient(ellipse at 0% 0%, color-mix(in srgb, var(--brick) 5%, transparent), transparent 55%),
      var(--paper);
    position: relative;
  }
  .back {
    position: absolute;
    top: 1.2rem;
    left: 1.4rem;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 1px solid var(--ink-tint-12);
    background: var(--ink-tint-04);
    color: var(--walnut);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
  }
  .back:hover {
    color: var(--espresso);
    border-color: var(--ink-tint-16);
    background: var(--ink-tint-08);
  }
  header {
    margin: 0.4rem 0 1.8rem 4.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .eyebrow {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--faded);
    font-weight: 500;
  }
  h1 {
    font-size: 2rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin: 0;
  }
  .meta {
    color: var(--faded);
    font-size: 0.82rem;
    letter-spacing: 0.02em;
    font-variant-numeric: tabular-nums;
  }
  .grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1.8rem 1rem;
  }
  .grid li { min-width: 0; }
  .empty {
    color: var(--faded);
    font-size: 0.85rem;
    margin-left: 4.2rem;
  }
  h2.section {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--walnut);
    font-weight: 600;
    margin: 2.6rem 0 0.3rem;
  }
  h2.section .count {
    color: var(--faded);
    font-weight: 500;
    font-size: 0.72rem;
  }
  .hint {
    color: var(--faded);
    font-size: 0.75rem;
    margin: 0 0 1.1rem;
  }
  .pulse-hint { margin-top: 2.6rem; }
  .card {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .cover {
    aspect-ratio: 1;
    border-radius: 6px;
    overflow: hidden;
    background: var(--ink-tint-04);
    margin-bottom: 0.5rem;
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .cover-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2.4rem;
    font-weight: 700;
    color: var(--faded);
  }
  .missing-cover { position: relative; }
  .missing-cover img { filter: saturate(0.55) brightness(0.85); transition: filter 200ms ease; }
  .card:hover .missing-cover img { filter: none; }
  .missing-action {
    position: absolute;
    left: 50%;
    bottom: 0.6rem;
    transform: translateX(-50%);
    background: rgba(20, 12, 6, 0.78);
    /* Fixed, not tokenised: this sits on album art, which no theme colours. */
    color: #fff;
    font-size: 0.66rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.25rem 0.6rem;
    border-radius: var(--radius-pill);
    white-space: nowrap;
    opacity: 0;
    transition: opacity 140ms ease;
  }
  .card:hover .missing-action,
  .card:focus-visible .missing-action { opacity: 1; }
  .title {
    font-size: 0.85rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .artist {
    font-size: 0.78rem;
    color: var(--walnut);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .year {
    font-size: 0.72rem;
    color: var(--faded);
    font-variant-numeric: tabular-nums;
  }
</style>
