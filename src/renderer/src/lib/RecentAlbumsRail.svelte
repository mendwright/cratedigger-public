<script lang="ts">
  import { onMount } from 'svelte'
  import type { PlexAlbum } from '../../../shared/plex'
  import { plexState, type ContextMenuEntry } from './plex-state.svelte'
  import { queueMenuItems } from './queue-menu'
  import AlbumCard from './AlbumCard.svelte'

  interface Props {
    expanded?: boolean
    hideHeading?: boolean
    count?: number
  }

  let {
    expanded = undefined,
    hideHeading = false,
    count = $bindable(0)
  }: Props = $props()

  let albums = $state<PlexAlbum[]>([])
  let loading = $state(false)

  const COLLAPSE_KEY = 'cratedigger:rail-collapsed:recently played'
  let internalCollapsed = $state(
    typeof window !== 'undefined' && localStorage.getItem(COLLAPSE_KEY) === '1'
  )
  const collapsed = $derived(expanded === undefined ? internalCollapsed : !expanded)
  function toggleCollapsed(): void {
    if (expanded !== undefined) return
    internalCollapsed = !internalCollapsed
    try {
      localStorage.setItem(COLLAPSE_KEY, internalCollapsed ? '1' : '0')
    } catch {
      // localStorage unavailable; collapse state stays in memory.
    }
  }

  // Keep the bindable count in sync with the loaded list so parent shelves
  // can show "recently played 12" without re-fetching.
  $effect(() => {
    count = albums.length
  })

  async function load(): Promise<void> {
    if (!plexState.session?.signedIn || !plexState.session.preferredServerId) return
    if (!plexState.activeSectionKey) return
    loading = true
    try {
      const page = await window.cratedigger.plex.listAlbums({
        serverId: plexState.session.preferredServerId,
        sectionKey: plexState.activeSectionKey,
        size: 16,
        sort: 'lastViewed'
      })
      // Plex returns lastViewedAt:desc but never-played albums come back too;
      // filter to just the ones with a real timestamp.
      albums = page.albums.filter((a) => a.lastViewedAt !== null).slice(0, 12)
    } catch {
      albums = []
    } finally {
      loading = false
    }
  }

  onMount(() => {
    void load()
  })

  $effect(() => {
    // Re-load when section changes (e.g. user switches between music libraries)
    plexState.activeSectionKey
    void load()
  })

  function albumCtxItems(a: PlexAlbum): ContextMenuEntry[] {
    return [
      { label: 'Play Now', onClick: () => void plexState.playback.requestCastAlbum(a.ratingKey, a.title, a.artist) },
      ...queueMenuItems('album', a.ratingKey, a.title, a.artist)
    ]
  }
</script>

{#if albums.length > 0 && !collapsed}
  <section class="rail">
    {#if !hideHeading}
      <button class="heading" type="button" onclick={toggleCollapsed} aria-expanded={!collapsed}>
        <span class="chev">▾</span>
        <span>recently played</span>
      </button>
    {/if}
    <ul class="row">
      {#each albums as a (a.ratingKey)}
        <li>
          <AlbumCard
            album={a}
            size={300}
            oncontextmenu={(e) => {
              e.preventDefault()
              plexState.openContextMenu(e.clientX, e.clientY, albumCtxItems(a))
            }}
          />
        </li>
      {/each}
    </ul>
  </section>
{:else if albums.length > 0 && !hideHeading}
  <section class="rail rail-collapsed">
    <button class="heading" type="button" onclick={toggleCollapsed} aria-expanded={!collapsed}>
      <span class="chev">▸</span>
      <span>recently played</span>
      <span class="count">{albums.length}</span>
    </button>
  </section>
{:else if loading && !hideHeading}
  <section class="rail loading">
    <div class="heading-static">recently played</div>
  </section>
{/if}

<style>
  .rail {
    margin: 0 0 1.6rem;
    --cover-size: 160px;
  }
  .heading {
    text-transform: lowercase;
    color: var(--faded);
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    margin: 0 0 0.6rem;
    background: transparent;
    border: 0;
    padding: 0.1rem 0.25rem 0.1rem 0;
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    border-radius: var(--radius-sm);
  }
  .heading:hover { color: var(--espresso); background: var(--hairline); }
  .heading-static {
    text-transform: lowercase;
    color: var(--faded);
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    margin: 0 0 0.6rem;
  }
  .chev {
    display: inline-block;
    width: 0.8rem;
    text-align: center;
    font-size: 0.65rem;
    opacity: 0.7;
  }
  .count {
    font-size: 0.7rem;
    color: var(--ink-tint-12);
    margin-left: 0.15rem;
  }
  .rail-collapsed { margin-bottom: 0.4rem; }
  .row {
    list-style: none;
    padding: 0 0 0.4rem;
    margin: 0;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 160px;
    gap: 1rem;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    scrollbar-color: var(--ink-tint-12) transparent;
  }
  .row::-webkit-scrollbar { height: 8px; }
  .row::-webkit-scrollbar-thumb {
    background: var(--ink-tint-12);
    border-radius: var(--radius-pill);
  }
  .row::-webkit-scrollbar-thumb:hover { background: rgba(43, 29, 18, 0.22); }
  .loading { min-height: 1.5rem; }
</style>
