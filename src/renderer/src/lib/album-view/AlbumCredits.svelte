<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { AlbumCredits, AlbumDetail } from '../../../../shared/plex'
  import { plexState } from '../plex-state.svelte'
  import { groupCredits } from './helpers'

  // The per-role credits section. "Match on MusicBrainz" / "reset" are common
  // to both screens; album-detail passes a `extraActions` snippet for the
  // merge/delete controls that don't belong on the now-playing view.
  let {
    detail,
    credits,
    creditsLoading,
    creditsError,
    extraActions
  }: {
    detail: AlbumDetail
    credits: AlbumCredits | null
    creditsLoading: boolean
    creditsError: string | null
    extraActions?: Snippet
  } = $props()

  const grouped = $derived(groupCredits(credits))
</script>

<div class="credits-slot">
  <div class="credits-head">
    <div class="label">credits</div>
    <div class="credits-actions">
      <button
        class="match-btn"
        onclick={() =>
          plexState.manualMatch.open(detail.album.ratingKey, detail.album.artist, detail.album.title)}
      >match on musicbrainz</button>
      <button
        class="match-btn subtle"
        onclick={() => void plexState.manualMatch.clearMatch(detail.album.ratingKey)}
        title="Reset to automatic match"
      >reset</button>
      {#if extraActions}{@render extraActions()}{/if}
    </div>
  </div>
  {#if creditsLoading}
    <p class="hint">looking up on musicbrainz…</p>
  {:else if creditsError}
    <p class="hint">{creditsError}</p>
  {:else if grouped.length === 0}
    <p class="hint">no credit data on MB.</p>
  {:else}
    <ul class="credit-groups">
      {#each grouped as g (g.role + '::' + g.label)}
        <li>
          <div class="role">{g.label}</div>
          <div class="people">
            {#each [...g.people.entries()] as [mbid, name] (mbid)}
              <button class="person" onclick={() => void plexState.openEntity(mbid, name)}>
                {name}
              </button>
            {/each}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .credits-slot {
    margin-top: 2.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--ink-tint-04);
  }
  .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--faded);
    margin-bottom: 0.4rem;
  }
  .credits-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .credits-actions {
    display: flex;
    gap: 0.4rem;
  }
  /* :global so the merge/delete buttons passed in via the extraActions
     snippet (owned by the parent screen) pick up the same pill styling. */
  .credits-actions :global(.match-btn) {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--faded);
    font-size: 0.72rem;
    padding: 0.25rem 0.7rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
  }
  .credits-actions :global(.match-btn:hover) {
    border-color: var(--brick);
    color: var(--brick);
  }
  .credits-actions :global(.match-btn.subtle),
  .credits-actions :global(.match-btn.subtle:hover) {
    color: var(--faded);
    border-color: var(--hairline);
  }
  .credits-actions :global(.match-btn.danger) {
    color: var(--err-fg);
    border-color: var(--warn-border);
  }
  .credits-actions :global(.match-btn.danger:hover:not(:disabled)) {
    border-color: var(--err-fg);
    color: var(--err-fg);
    background: var(--warn-bg);
  }
  .credits-actions :global(.match-btn.danger.confirm) {
    background: var(--warn-bg);
    color: var(--err-fg);
    border-color: var(--err-fg);
  }
  .credits-actions :global(.match-btn:disabled) {
    opacity: 0.55;
    cursor: default;
  }
  .credit-groups {
    list-style: none;
    padding: 0;
    margin: 0.75rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .credit-groups li {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }
  .role {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--faded);
    min-width: 120px;
    padding-top: 0.25rem;
    flex-shrink: 0;
  }
  .people {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.5rem;
  }
  .person {
    background: var(--ink-tint-04);
    border: 1px solid var(--ink-tint-08);
    color: var(--espresso);
    font-size: 0.82rem;
    padding: 0.25rem 0.7rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: border-color 140ms ease, color 140ms ease, background 140ms ease, transform 80ms ease;
  }
  .person:hover {
    border-color: rgba(140, 53, 34, 0.5);
    color: var(--brick);
    background: var(--brick-wash);
  }
  .person:active {
    transform: scale(0.97);
  }
  .hint {
    color: var(--faded);
    font-size: 0.85rem;
    margin: 0;
  }
</style>
