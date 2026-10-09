<script lang="ts">
  import type { PlexAlbum } from '../../../../shared/plex'
  import AlbumCard from '../AlbumCard.svelte'

  // "Sounds like this" rail — other artists' albums nearest the open one in
  // Plex's sonic analysis. Scoped data lives on the screen's loader, so the
  // screen passes it in. Hidden entirely when the server has no analysis.
  let {
    rail,
    loading
  }: {
    rail: PlexAlbum[] | null
    loading: boolean
  } = $props()
</script>

{#if loading && !rail}
  <div class="rail-slot">
    <div class="label">sounds like this</div>
    <p class="hint">listening for neighbors…</p>
  </div>
{:else if rail && rail.length > 0}
  <div class="rail-slot">
    <div class="label" title="Nearest albums in Plex's sonic analysis">sounds like this</div>
    <ul class="rail">
      {#each rail as a (a.ratingKey)}
        <li><AlbumCard album={a} /></li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .rail-slot {
    margin-top: 2.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--ink-tint-04);
  }
  .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--faded);
    font-weight: 500;
    margin-bottom: 0.9rem;
  }
  ul.rail {
    list-style: none;
    padding: 0 0 0.6rem;
    margin: 0;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 148px;
    gap: 1rem;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--ink-tint-12) transparent;
  }
  ul.rail::-webkit-scrollbar {
    height: 8px;
  }
  ul.rail::-webkit-scrollbar-thumb {
    background: var(--ink-tint-12);
    border-radius: var(--radius-pill);
  }
  ul.rail li {
    min-width: 0;
  }
  .hint {
    color: var(--faded);
    font-size: 0.85rem;
    margin: 0;
  }
</style>
