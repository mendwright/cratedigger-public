<script lang="ts">
  import { plexState } from './plex-state.svelte'
  import { hasCrateTag } from './crate-tags'

  const req = $derived(plexState.addToCrate)
  const ctl = $derived(plexState.cratesCtl)
  // Which crates already hold this album — null when the album isn't in any
  // in-memory cache (rows then act as plain "add", which Plex dedupes).
  const memberships = $derived(req ? plexState.albumCrates(req.ratingKey) : null)
  const rows = $derived(
    ctl.crates.map((c) => ({ c, member: memberships !== null && hasCrateTag(memberships, c.title) }))
  )

  let newName = $state('')
  // Crate that just got toggled — drives a brief pulse on its row so the
  // click visibly landed even before the eye finds the checkmark.
  let flashKey = $state<string | null>(null)
  let flashTimer: number | null = null

  function close(): void {
    newName = ''
    flashKey = null
    plexState.closeAddToCrate()
  }

  function onKey(e: KeyboardEvent): void {
    if (!req) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    }
  }

  // Toggle: filed → take it out, not filed → file it. The modal stays open
  // so several crates can be flipped in one visit; rows update live off the
  // patched album caches (optimistically — the controller flips before the
  // server answers and rolls back on error).
  async function toggle(row: { c: (typeof ctl.crates)[number]; member: boolean }): Promise<void> {
    if (!req) return
    const album = { ratingKey: req.ratingKey, label: req.label }
    if (flashTimer !== null) window.clearTimeout(flashTimer)
    flashKey = row.c.ratingKey
    flashTimer = window.setTimeout(() => {
      flashKey = null
      flashTimer = null
    }, 500)
    if (row.member) await ctl.removeItem(row.c, album)
    else await ctl.add(row.c, album)
  }

  async function createAndAdd(e: Event): Promise<void> {
    e.preventDefault()
    if (!req || !newName.trim()) return
    const name = newName.trim()
    newName = ''
    await ctl.create(name, { ratingKey: req.ratingKey, label: req.label })
  }
</script>

<svelte:window onkeydown={onKey} />

{#if req}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={close}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Add to crate" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <div class="head">
        <div class="title">Add to crate</div>
        <div class="sub">{req.label}</div>
      </div>

      {#if ctl.loading && ctl.crates.length === 0}
        <p class="hint">loading crates…</p>
      {:else if rows.length === 0}
        <p class="hint">no crates yet — name your first one below.</p>
      {:else}
        <ul>
          {#each rows as row (row.c.ratingKey)}
            <li>
              <button
                class="row"
                class:member={row.member}
                class:flash={flashKey === row.c.ratingKey}
                onclick={() => void toggle(row)}
              >
                <span class="row-check" aria-hidden="true">{row.member ? '✓' : ''}</span>
                <span class="row-title">{row.c.title}</span>
                <span class="row-sub">
                  {row.member ? 'in this crate — ' : ''}{row.c.childCount} album{row.c.childCount === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <form class="new" onsubmit={createAndAdd}>
        <input type="text" placeholder="new crate name…" bind:value={newName} />
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
    background: rgba(var(--shadow-color), 0.28);
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
    gap: 0.55rem;
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
  .row:hover { border-color: var(--brick); }
  .row.member {
    border-color: var(--ok-border);
    background: var(--ok-bg);
    color: var(--ok-fg);
  }
  .row.flash {
    animation: crate-pulse 450ms ease-out;
  }
  @keyframes crate-pulse {
    0% { transform: scale(1); }
    30% { transform: scale(1.03); box-shadow: 0 0 0 3px var(--brick-wash); }
    100% { transform: scale(1); }
  }
  .row-check {
    width: 0.9rem;
    flex-shrink: 0;
    font-weight: 700;
  }
  .row-title {
    flex: 1;
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-sub { font-size: 0.72rem; color: var(--faded); flex-shrink: 0; }
  .row.member .row-sub { color: currentColor; opacity: 0.75; }
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
  .primary:hover:not(:disabled) { background: var(--brick); color: var(--on-brick); border-color: var(--brick); }
  .primary:disabled { opacity: 0.5; cursor: default; }
</style>
