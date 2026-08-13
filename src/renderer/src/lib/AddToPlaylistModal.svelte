<script lang="ts">
  import { plexState } from './plex-state.svelte'

  const req = $derived(plexState.addToPlaylist)
  const ctl = $derived(plexState.playlistsCtl)
  // Materialized smart playlists are rule-owned — a manual add would be
  // wiped on the next sync, so they're shown disabled.
  const rows = $derived(
    ctl.playlists.map((p) => ({ p, managed: ctl.smartDefFor(p.ratingKey) !== null }))
  )

  let newName = $state('')

  function close(): void {
    newName = ''
    plexState.closeAddToPlaylist()
  }

  function onKey(e: KeyboardEvent): void {
    if (!req) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    }
  }

  async function addTo(playlistRatingKey: string): Promise<void> {
    if (!req) return
    const { ratingKey, label } = req
    close()
    await ctl.addItems(playlistRatingKey, [ratingKey], label)
  }

  async function createAndAdd(e: Event): Promise<void> {
    e.preventDefault()
    if (!req || !newName.trim()) return
    const { ratingKey } = req
    const name = newName.trim()
    close()
    // create() toasts on success and seeds the playlist with the item.
    await ctl.create(name, [ratingKey])
  }
</script>

<svelte:window onkeydown={onKey} />

{#if req}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={close}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Add to playlist" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <div class="head">
        <div class="title">Add to playlist</div>
        <div class="sub">{req.label}</div>
      </div>

      {#if ctl.loading && ctl.playlists.length === 0}
        <p class="hint">loading playlists…</p>
      {:else if rows.length === 0}
        <p class="hint">no playlists yet — name one below.</p>
      {:else}
        <ul>
          {#each rows as { p, managed } (p.ratingKey)}
            <li>
              <button class="row" disabled={managed} onclick={() => void addTo(p.ratingKey)}>
                <span class="row-title">{p.title}</span>
                <span class="row-sub">
                  {managed ? 'managed by rules' : `${p.leafCount} track${p.leafCount === 1 ? '' : 's'}`}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <form class="new" onsubmit={createAndAdd}>
        <input type="text" placeholder="new playlist name…" bind:value={newName} />
        <button type="submit" class="primary" disabled={!newName.trim()}>create + add</button>
      </form>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: var(--ink-tint-16, rgba(0, 0, 0, 0.25));
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fade-in 140ms ease-out;
  }
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .dialog {
    width: min(420px, calc(100vw - 3rem));
    max-height: min(560px, calc(100vh - 6rem));
    display: flex;
    flex-direction: column;
    background: var(--paper);
    border: 1px solid var(--hairline-strong);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-md);
    padding: 1.1rem;
    gap: 0.8rem;
  }
  .title { font-weight: 650; font-size: 1.05rem; }
  .sub {
    font-size: 0.8rem;
    color: var(--faded);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint { color: var(--faded); font-size: 0.85rem; margin: 0; }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .row {
    width: 100%;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.7rem;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: 0.5rem 0.7rem;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: left;
    min-width: 0;
  }
  .row:hover:not(:disabled) { border-color: var(--brick); }
  .row:disabled { opacity: 0.55; cursor: default; }
  .row-title { font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-sub { font-size: 0.72rem; color: var(--faded); flex-shrink: 0; }
  .new { display: flex; gap: 0.45rem; }
  .new input {
    flex: 1;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: 0.45rem 0.65rem;
    font: inherit;
    color: inherit;
    min-width: 0;
  }
  .primary {
    font: inherit;
    background: var(--espresso);
    color: var(--paper);
    border: 1px solid var(--espresso);
    border-radius: var(--radius-pill);
    padding: 0.4rem 0.85rem;
    cursor: pointer;
    flex-shrink: 0;
  }
  .primary:hover:not(:disabled) { background: var(--brick); border-color: var(--brick); }
  .primary:disabled { opacity: 0.5; cursor: default; }
</style>
