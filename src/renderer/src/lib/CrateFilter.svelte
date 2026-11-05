<script lang="ts">
  import { plexState } from './plex-state.svelte'
  import type { PlexCollection } from '../../../shared/plex'

  const ctl = $derived(plexState.cratesCtl)
  const selected = $derived(plexState.filterState.selectedCrate)

  // Two-step delete: first click arms the row, second click deletes. Armed
  // state clears when the panel closes or another row is armed.
  let pendingDelete = $state<string | null>(null)

  function close(): void {
    pendingDelete = null
    plexState.closeCrateFilter()
  }

  function onBackdropKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
  }

  function pick(c: PlexCollection): void {
    plexState.setCrate({ ratingKey: c.ratingKey, title: c.title })
  }

  async function del(c: PlexCollection): Promise<void> {
    if (pendingDelete !== c.ratingKey) {
      pendingDelete = c.ratingKey
      return
    }
    pendingDelete = null
    await ctl.remove(c)
  }
</script>

{#if plexState.crateFilterOpen}
  <div
    class="backdrop"
    role="button"
    tabindex="0"
    aria-label="Close crate filter"
    onclick={close}
    onkeydown={onBackdropKey}
  ></div>
  <aside class="panel" aria-label="Crate filter">
    <header>
      <h2>Crates</h2>
      <button class="x" onclick={close} aria-label="Close">✕</button>
    </header>

    {#if ctl.loading && ctl.crates.length === 0}
      <div class="status"><div class="hint">loading crates…</div></div>
    {:else if ctl.error}
      <div class="status"><div class="hint">couldn't load crates: {ctl.error}</div></div>
    {:else if ctl.crates.length === 0}
      <div class="status">
        <div class="hint">
          no crates yet — right-click any album and pick “Add to Crate…” to start one.
        </div>
      </div>
    {:else}
      <div class="status">
        <div class="hint">pick a crate to flip through just those records</div>
        {#if selected}
          <button class="clear-sel" onclick={() => plexState.clearCrate()}>clear ({selected.title})</button>
        {/if}
      </div>
      <ul class="crates">
        {#each ctl.crates as c (c.ratingKey)}
          <li class="crate-row">
            <button
              class="crate"
              class:active={selected?.ratingKey === c.ratingKey}
              onclick={() => pick(c)}
              title={selected?.ratingKey === c.ratingKey ? 'Clear crate' : `Browse “${c.title}”`}
            >
              <span class="name">{c.title}</span>
              <span class="count">{c.childCount}</span>
            </button>
            <button
              class="del"
              class:armed={pendingDelete === c.ratingKey}
              onclick={() => void del(c)}
              title={pendingDelete === c.ratingKey
                ? 'Click again to delete this crate (albums are kept)'
                : 'Delete crate'}
              aria-label="Delete crate {c.title}"
            >
              {pendingDelete === c.ratingKey ? 'sure?' : '✕'}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(var(--shadow-color), 0.28);
    z-index: 55;
    border: 0;
    padding: 0;
  }
  .panel {
    position: fixed;
    right: 12px;
    top: 72px;
    bottom: 100px;
    width: 320px;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    z-index: 60;
    animation: pop 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
    color: var(--espresso);
  }
  @keyframes pop {
    from { transform: translateY(10px) scale(0.98); opacity: 0; }
    to { transform: translateY(0) scale(1); opacity: 1; }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.7rem 0.9rem 0.5rem;
    border-bottom: 1px solid var(--hairline);
  }
  h2 {
    font-family: var(--font-display);
    font-size: 1rem; font-weight: 600; margin: 0; letter-spacing: 0.01em;
    color: var(--espresso);
  }
  .x {
    background: transparent;
    border: 0;
    color: var(--faded);
    font-size: 0.9rem;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }
  .x:hover { background: var(--ink-tint-08); color: var(--espresso); }
  .status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.55rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--hairline);
  }
  .hint { font-size: 0.78rem; color: var(--walnut); line-height: 1.4; }
  .clear-sel {
    background: transparent;
    color: var(--brick);
    border: 0;
    font-size: 0.72rem;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .clear-sel:hover { background: var(--brick-wash); }
  ul.crates {
    list-style: none;
    margin: 0;
    padding: 0.3rem;
    overflow-y: auto;
    flex: 1;
  }
  .crate-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 0.25rem;
  }
  .crate {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.45rem 0.7rem;
    border-radius: var(--radius-md);
    background: transparent;
    border: 0;
    color: var(--espresso);
    font-size: 0.88rem;
    cursor: pointer;
    text-align: left;
    font: inherit;
    min-width: 0;
  }
  .crate:hover { background: var(--ink-tint-04); }
  .crate.active {
    background: var(--brick-wash);
    color: var(--brick-deep);
  }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count {
    color: var(--faded);
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
  }
  .crate.active .count { color: currentColor; opacity: 0.75; }
  .del {
    background: transparent;
    border: 0;
    color: var(--faded);
    cursor: pointer;
    min-width: 26px;
    height: 26px;
    border-radius: var(--radius-md);
    font-size: 0.75rem;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
  }
  .del:hover { color: var(--espresso); background: var(--ink-tint-06); }
  .del.armed {
    color: var(--warn-fg);
    background: var(--warn-bg);
  }
</style>
