<script lang="ts">
  import type { SimilarArtist } from '../../../../shared/plex'
  import { plexState } from '../plex-state.svelte'

  // "Similar artists" chip rail — in-library artists first (with album counts),
  // then a dashed divider and out-of-library suggestions. Scoped data lives on
  // plex-state per screen, so the screen passes it in.
  let {
    similar,
    loading
  }: {
    similar: SimilarArtist[] | null
    loading: boolean
  } = $props()

  const inLibrary = $derived(similar?.filter((s) => s.inLibrary) ?? [])
  const notInLibrary = $derived(similar?.filter((s) => !s.inLibrary) ?? [])
</script>

{#if loading && !similar}
  <div class="rail-slot">
    <div class="label">similar artists</div>
    <p class="hint">looking up on musicbrainz…</p>
  </div>
{:else if similar && similar.length > 0}
  <div class="rail-slot">
    <div class="label">similar artists</div>
    <ul class="artist-rail">
      {#each inLibrary as a (a.mbid || `name:${a.name.toLowerCase()}`)}
        <li>
          <button
            class="artist-chip in-library"
            onclick={() => void plexState.openSimilarArtist(a)}
            title={a.reasons.join(', ')}
          >
            <span class="chip-name">{a.name}</span>
            {#if a.albumCount > 0}
              <span class="chip-count">{a.albumCount}</span>
            {/if}
          </button>
        </li>
      {/each}
      {#if notInLibrary.length > 0}
        <li class="divider" aria-hidden="true"></li>
        {#each notInLibrary as a (a.mbid || `name:${a.name.toLowerCase()}`)}
          <li>
            <button
              class="artist-chip"
              onclick={() => void plexState.openSimilarArtist(a)}
              title={a.reasons.join(', ')}
            >
              <span class="chip-name">{a.name}</span>
            </button>
          </li>
        {/each}
      {/if}
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
  ul.artist-rail {
    list-style: none;
    padding: 0 0 0.4rem;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    align-items: center;
  }
  ul.artist-rail li.divider {
    flex-basis: 100%;
    height: 0;
    border-top: 1px dashed var(--ink-tint-08);
    margin: 0.35rem 0 0.25rem;
  }
  .artist-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--ink-tint-04);
    color: var(--walnut);
    border: 1px solid var(--ink-tint-08);
    padding: 0.35rem 0.8rem;
    border-radius: var(--radius-pill);
    font-size: 0.82rem;
    cursor: pointer;
    font: inherit;
    transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
  }
  .artist-chip:hover {
    color: var(--espresso);
    border-color: color-mix(in srgb, var(--brick) 45%, transparent);
    background: var(--brick-wash);
  }
  .artist-chip.in-library {
    background: color-mix(in srgb, var(--brick) 10%, transparent);
    border-color: color-mix(in srgb, var(--brick) 35%, transparent);
    color: var(--brick-deep);
  }
  .artist-chip.in-library:hover {
    background: color-mix(in srgb, var(--brick) 18%, transparent);
    border-color: color-mix(in srgb, var(--brick) 60%, transparent);
  }
  .chip-count {
    background: var(--ink-tint-12);
    color: var(--faded);
    border-radius: var(--radius-pill);
    padding: 0.05rem 0.45rem;
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
  }
  .artist-chip.in-library .chip-count {
    background: color-mix(in srgb, var(--brick) 18%, transparent);
    color: var(--brick-deep);
  }
  .hint {
    color: var(--faded);
    font-size: 0.85rem;
    margin: 0;
  }
</style>
