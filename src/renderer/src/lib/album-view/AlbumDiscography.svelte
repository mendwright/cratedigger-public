<script lang="ts">
  import type { AlbumDetail } from '../../../../shared/plex'
  import { plexState } from '../plex-state.svelte'
  import { getDiscography } from './helpers'

  let { detail }: { detail: AlbumDetail } = $props()

  const discography = $derived.by(() => getDiscography(detail, plexState.allAlbums))

  let discogEl = $state<HTMLDivElement | null>(null)
  $effect(() => {
    if (!discogEl || discography.length <= 1) return
    const el = discogEl.querySelector('.discog-item.current') as HTMLElement | null
    if (el) el.scrollIntoView({ inline: 'center', block: 'nearest' })
  })
</script>

{#if discography.length > 1}
  <div class="discography-strip" bind:this={discogEl}>
    {#each discography as a (a.ratingKey)}
      <button
        type="button"
        class="discog-item"
        class:current={a.ratingKey === detail.album.ratingKey}
        title={`${a.title}${a.year ? ` · ${a.year}` : ''}`}
        onclick={() => void plexState.openAlbumDetail(a.ratingKey)}
      >
        {#if a.thumb}
          <img src={plexState.thumbUrl(a.thumb, 96, a.ratingKey) ?? ''} alt={a.title} loading="lazy" />
        {:else}
          <div class="discog-fallback"></div>
        {/if}
        {#if a.year}<span class="discog-year">{a.year}</span>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .discography-strip {
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    margin-top: 0.75rem;
    padding: 4px 2px 6px;
    scrollbar-width: thin;
  }
  .discog-item {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    background: transparent;
    border: 2px solid transparent;
    border-radius: var(--radius-md);
    padding: 2px;
    cursor: pointer;
    transition: border-color 140ms ease, transform 100ms ease;
    font: inherit;
  }
  .discog-item:hover {
    transform: scale(1.06);
  }
  .discog-item.current {
    border-color: var(--brick);
  }
  .discog-item img,
  .discog-fallback {
    width: 56px;
    height: 56px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    background: var(--surface-deep);
    display: block;
  }
  .discog-year {
    font-size: 0.62rem;
    color: var(--faded);
    font-variant-numeric: tabular-nums;
  }
  .discog-item.current .discog-year {
    color: var(--brick);
    font-weight: 600;
  }
</style>
