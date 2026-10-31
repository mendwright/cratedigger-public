<script lang="ts">
  import type { PlexAlbum } from '../../../shared/plex'
  import { plexState, type ContextMenuEntry } from './plex-state.svelte'
  import { queueMenuItems } from './queue-menu'
  import AlbumCard from './AlbumCard.svelte'

  // Generic horizontal rail driven by a client-side filter over the fully
  // loaded library (plexState.allAlbums). Used by the Library home for
  // editorial shelves like "neglected gems" — pure derived state, zero IPC.

  interface Props {
    title: string
    filter: (album: PlexAlbum) => boolean
    cap?: number
    sort?: 'added' | 'year' | 'rating' | 'lastViewed'
    // When supplied, the parent controls expansion (and the rail's own
    // heading is suppressed). Used by the Library shelf, where the pill
    // toggles live in a horizontal row separate from the expanded rows.
    expanded?: boolean
    hideHeading?: boolean
    // Bindable so a parent shelf can show the count in its pill without
    // re-running the filter.
    count?: number
  }

  let {
    title,
    filter,
    cap = 16,
    sort = 'added',
    expanded = undefined,
    hideHeading = false,
    count = $bindable(0)
  }: Props = $props()

  const collapseKey = $derived(`cratedigger:rail-collapsed:${title}`)
  // Read the persisted collapse state once at mount. `title` is constant for
  // a given rail instance, so capturing the initial value is intentional.
  // svelte-ignore state_referenced_locally
  let internalCollapsed = $state(
    typeof window !== 'undefined' &&
      localStorage.getItem(`cratedigger:rail-collapsed:${title}`) === '1'
  )
  // External `expanded` wins. Standalone use falls back to localStorage.
  const collapsed = $derived(expanded === undefined ? internalCollapsed : !expanded)
  function toggleCollapsed(): void {
    if (expanded !== undefined) return  // parent owns the state
    internalCollapsed = !internalCollapsed
    try {
      localStorage.setItem(collapseKey, internalCollapsed ? '1' : '0')
    } catch {
      // localStorage can throw in privacy modes; collapse state stays in
      // memory for this session.
    }
  }

  // Trigger allAlbums load if the home is empty when this rail mounts.
  $effect(() => {
    if (plexState.allAlbums === null) void plexState.ensureAllAlbumsLoaded()
  })

  const albums = $derived.by(() => {
    const all = plexState.allAlbums
    if (!all) return [] as PlexAlbum[]
    const out: PlexAlbum[] = []
    for (const a of all) {
      if (filter(a)) out.push(a)
      if (out.length >= cap * 2) break // hard ceiling before sort
    }
    out.sort((x, y) => {
      if (sort === 'added') return (y.addedAt ?? 0) - (x.addedAt ?? 0)
      if (sort === 'year') return (y.year ?? 0) - (x.year ?? 0)
      if (sort === 'rating') return (y.rating ?? 0) - (x.rating ?? 0)
      return (y.lastViewedAt ?? 0) - (x.lastViewedAt ?? 0)
    })
    return out.slice(0, cap)
  })

  // Keep the bindable count in sync with the filter result so parent
  // shelves can show "neglected gems 12" without re-running the filter.
  $effect(() => {
    count = albums.length
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
        <span>{title}</span>
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
      <span>{title}</span>
      <span class="count">{albums.length}</span>
    </button>
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
  .row::-webkit-scrollbar-thumb:hover { background: var(--ink-tint-16); }
</style>
