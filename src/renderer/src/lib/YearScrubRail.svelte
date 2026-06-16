<script lang="ts">
  import { onMount } from 'svelte'
  import type { PlexAlbum } from '../../../shared/plex'
  import { plexState, type ContextMenuEntry } from './plex-state.svelte'
  import { queueMenuItems } from './queue-menu'
  import AlbumCard from './AlbumCard.svelte'

  let allAlbums = $state<PlexAlbum[] | null>(null)
  let selectedYear = $state<number | null>(null)

  // Bucket albums by the year of their last play. lastViewedAt is Unix seconds.
  // Albums never played are excluded.
  const buckets = $derived.by(() => {
    if (!allAlbums) return new Map<number, PlexAlbum[]>()
    const map = new Map<number, PlexAlbum[]>()
    for (const a of allAlbums) {
      if (!a.lastViewedAt) continue
      const y = new Date(a.lastViewedAt * 1000).getFullYear()
      if (!Number.isFinite(y)) continue
      let list = map.get(y)
      if (!list) {
        list = []
        map.set(y, list)
      }
      list.push(a)
    }
    for (const list of map.values()) {
      list.sort((x, z) => (z.lastViewedAt ?? 0) - (x.lastViewedAt ?? 0))
    }
    return map
  })

  const years = $derived([...buckets.keys()].sort((a, b) => b - a))
  const yearAlbums = $derived(
    selectedYear !== null ? (buckets.get(selectedYear) ?? []).slice(0, 12) : []
  )

  $effect(() => {
    // Default to the most recent completed year on first load — the current
    // year overlaps too much with the "recently played" rail above.
    // User clicks override this; we only set the default while no selection.
    if (selectedYear === null && years.length > 0) {
      const thisYear = new Date().getFullYear()
      selectedYear = years.find((y) => y < thisYear) ?? years[0]
    }
  })

  onMount(async () => {
    try {
      allAlbums = await plexState.ensureAllAlbumsLoaded()
    } catch {
      allAlbums = []
    }
  })

  function albumCtxItems(a: PlexAlbum): ContextMenuEntry[] {
    return [
      {
        label: 'Play Now',
        onClick: () => void plexState.playback.requestCastAlbum(a.ratingKey, a.title, a.artist)
      },
      ...queueMenuItems('album', a.ratingKey, a.title, a.artist)
    ]
  }
</script>

{#if years.length >= 4}
  <section class="rail">
    <div class="heading">
      <span>your year in records</span>
      {#if selectedYear !== null}
        <span class="count">
          {buckets.get(selectedYear)?.length ?? 0} album{(buckets.get(selectedYear)?.length ?? 0) === 1 ? '' : 's'}
        </span>
      {/if}
    </div>
    <ul class="years">
      {#each years as y (y)}
        <li>
          <button
            class="year"
            class:active={y === selectedYear}
            onclick={() => (selectedYear = y)}
          >
            {y}
            <span class="year-count">{buckets.get(y)?.length ?? 0}</span>
          </button>
        </li>
      {/each}
    </ul>
    {#if yearAlbums.length > 0}
      <ul class="row">
        {#each yearAlbums as a (a.ratingKey)}
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
    {/if}
  </section>
{/if}

<style>
  .rail {
    margin: 0 0 1.6rem;
    --cover-size: 160px;
  }
  .heading {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    text-transform: lowercase;
    color: var(--faded);
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    margin: 0 0 0.6rem;
  }
  .count { color: var(--faded); font-size: 0.7rem; }
  .years {
    list-style: none;
    padding: 0 0 0.6rem;
    margin: 0 0 0.8rem;
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--ink-tint-12) transparent;
    border-bottom: 1px solid var(--ink-tint-04);
  }
  .years::-webkit-scrollbar { height: 6px; }
  .years::-webkit-scrollbar-thumb {
    background: rgba(43, 29, 18, 0.1);
    border-radius: var(--radius-pill);
  }
  .year {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
    background: transparent;
    border: 1px solid var(--ink-tint-08);
    color: var(--walnut);
    padding: 0.4rem 0.85rem;
    border-radius: var(--radius-pill);
    font-size: 0.85rem;
    cursor: pointer;
    white-space: nowrap;
    transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
  }
  .year:hover {
    color: var(--espresso);
    border-color: rgba(43, 29, 18, 0.2);
  }
  .year.active {
    color: var(--surface);
    background: var(--brick);
    border-color: var(--brick);
  }
  .year-count {
    font-size: 0.7rem;
    color: inherit;
    opacity: 0.7;
  }
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
</style>
