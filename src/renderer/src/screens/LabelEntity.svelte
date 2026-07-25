<script lang="ts">
  import { plexState } from '../lib/plex-state.svelte'
  import AlbumCard from '../lib/AlbumCard.svelte'

  interface Props {
    name: string
  }
  const { name }: Props = $props()

  const albums = $derived(plexState.filterLibraryByLabel(name))
  const allAlbums = $derived(plexState.allAlbums)
  const allAlbumsLoading = $derived(plexState.allAlbumsLoading)

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
    <ul class="grid">
      {#each albums as a (a.ratingKey)}
        <li><AlbumCard album={a} /></li>
      {/each}
    </ul>
  {:else if !allAlbumsLoading}
    <p class="empty">nothing matched.</p>
  {/if}
</section>

<style>
  section {
    height: 100%;
    box-sizing: border-box;
    padding: 1.2rem 2rem 2rem;
    overflow-y: auto;
    background:
      radial-gradient(ellipse at 0% 0%, rgba(140, 53, 34, 0.05), transparent 55%),
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
    border: 1px solid rgba(43, 29, 18, 0.1);
    background: var(--ink-tint-04);
    color: var(--walnut);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
  }
  .back:hover {
    color: #fff;
    border-color: rgba(43, 29, 18, 0.2);
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
</style>
