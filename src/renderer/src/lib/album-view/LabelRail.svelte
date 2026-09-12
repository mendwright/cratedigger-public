<script lang="ts">
  import type { PlexAlbum } from '../../../../shared/plex'
  import { plexState } from '../plex-state.svelte'
  import AlbumCard from '../AlbumCard.svelte'

  // "More from {label}" rail. The scoped rail data lives on plex-state per
  // screen (album vs. now-playing), so the screen passes it in.
  let {
    rail,
    names,
    loading
  }: {
    rail: PlexAlbum[] | null
    names: string[]
    loading: boolean
  } = $props()

  const linkNames = $derived(names.slice(0, 2))
  const hasMore = $derived(names.length > 2)
  const show = $derived(loading && (!rail || rail.length === 0) ? 'loading' : (rail && rail.length > 0 ? 'rail' : 'none'))
</script>

{#if show !== 'none'}
  <div class="rail-slot">
    <div class="label">
      {#if linkNames.length === 0}
        more from this label
      {:else}
        more from {#each linkNames as name, i (name)}<button
            type="button"
            class="label-rail-link"
            onclick={() => plexState.openLabelEntity(name)}
            title={`See all albums on ${name}`}
          >{name}</button>{#if i < linkNames.length - 1} · {/if}{/each}{#if hasMore} …{/if}
      {/if}
    </div>
    {#if show === 'loading'}
      <p class="hint">looking up label matches…</p>
    {:else if rail}
      <ul class="rail">
        {#each rail as a (a.ratingKey)}
          <li><AlbumCard album={a} /></li>
        {/each}
      </ul>
    {/if}
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
  .label-rail-link {
    background: transparent;
    border: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    cursor: pointer;
    border-bottom: 1px solid transparent;
    transition: color 140ms ease, border-color 140ms ease;
  }
  .label-rail-link:hover {
    color: var(--brick);
    border-bottom-color: var(--brick);
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
