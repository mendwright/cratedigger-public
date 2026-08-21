<script lang="ts">
  import type { AlbumCredits, AlbumDetail } from '../../../../shared/plex'
  import { plexState } from '../plex-state.svelte'
  import { groupCredits } from './helpers'

  // The per-role credits section, identical on album-detail and now-playing.
  // Its only actions are the two MusicBrainz-match controls; delete used to be
  // injected here by album-detail and now lives under that screen's track list.
  let {
    detail,
    credits,
    creditsLoading,
    creditsError
  }: {
    detail: AlbumDetail
    credits: AlbumCredits | null
    creditsLoading: boolean
    creditsError: string | null
  } = $props()

  const grouped = $derived(groupCredits(credits))
</script>

<div class="credits-slot" data-personnel>
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
  .credits-actions .match-btn {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--faded);
    font-size: 0.72rem;
    padding: 0.25rem 0.7rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
  }
  .credits-actions .match-btn:hover {
    border-color: var(--brick);
    color: var(--brick);
  }
  .credits-actions .match-btn.subtle,
  .credits-actions .match-btn.subtle:hover {
    color: var(--faded);
    border-color: var(--hairline);
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
    border-color: color-mix(in srgb, var(--brick) 50%, transparent);
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
