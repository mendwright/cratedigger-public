<script lang="ts">
  import type { PlayQueueItem, RadioSteer } from '../../../shared/plex'
  import { plexState } from './plex-state.svelte'

  const snap = $derived(plexState.playback.queueSnapshot)
  const currentId = $derived(snap?.selectedItemID ?? null)
  const selIndex = $derived(
    snap ? snap.items.findIndex((it) => it.playQueueItemID === currentId) : -1
  )
  const history = $derived(snap && selIndex > 0 ? snap.items.slice(0, selIndex) : [])
  const current = $derived(snap && selIndex >= 0 ? snap.items[selIndex] : null)
  const upcoming = $derived(
    snap ? (selIndex < 0 ? snap.items.slice(1) : snap.items.slice(selIndex + 1)) : []
  )

  let historyOpen = $state(false)
  // Album groups render collapsed by default — this is an album player; the
  // queue reads as a stack of records. Keyed by group key.
  let expandedAlbums = $state<Record<string, boolean>>({})

  const staged = $derived(plexState.playback.radio.staged)

  // Group consecutive upcoming tracks by album — the queue reads as a stack
  // of records, not a flat track list. The group continuing the playing album
  // gets a "from this album" label instead of repeating the title; the
  // radio-staged album gets the Radio divider with veto/swap controls.
  interface QueueGroup {
    // Unique per group instance — the same record can legitimately appear in
    // the queue twice (queued again later, or radio re-picking it), so the
    // each-key includes the run's first playQueueItemID. Keying on the album
    // alone threw Svelte's duplicate-key error, which aborted the panel
    // render mid-patch and froze it on "Loading…".
    key: string
    albumKey: string
    fromCurrentAlbum: boolean
    isStaged: boolean
    album: string
    artist: string
    items: PlayQueueItem[]
  }
  const groups = $derived.by(() => {
    const out: QueueGroup[] = []
    for (const it of upcoming) {
      const albumKey = it.albumRatingKey ?? `title:${it.album}`
      const prev = out[out.length - 1]
      if (prev && prev.albumKey === albumKey) {
        prev.items.push(it)
      } else {
        out.push({
          key: `${albumKey}#${it.playQueueItemID}`,
          albumKey,
          fromCurrentAlbum:
            out.length === 0 &&
            !!current?.albumRatingKey &&
            it.albumRatingKey === current.albumRatingKey,
          isStaged: false,
          album: it.album,
          artist: it.artist,
          items: [it]
        })
      }
    }
    // The staged radio album is always the appended tail — only the last
    // group earns the divider, even if the same record sits earlier too.
    const tail = out[out.length - 1]
    if (tail && staged && tail.items[0].albumRatingKey === staged.albumRatingKey) {
      tail.isStaged = true
    }
    return out
  })

  const upcomingMs = $derived(upcoming.reduce((sum, it) => sum + (it.duration || 0), 0))

  const stagedSourceLabel = $derived.by(() => {
    if (!staged) return ''
    if (staged.source === 'listen-later') return 'from your Listen Later'
    if (staged.source === 'same-artist') return `more ${staged.artist}`
    if (staged.source === 'label-mate') return staged.via ? `on ${staged.via}` : 'label mate'
    if (staged.source === 'library') return staged.via ?? 'from the library'
    if (staged.source === 'surprise') return 'wildcard from the crate'
    return `similar to ${current?.artist ?? staged.artist}`
  })

  const STEERS: { id: RadioSteer; label: string; hint: string }[] = [
    { id: 'drift', label: 'drift', hint: 'Follow the vibe of what’s playing' },
    { id: 'label', label: 'label', hint: 'Stay on this album’s record label' },
    { id: 'genre', label: 'genre', hint: 'Stay in this genre' },
    { id: 'era', label: 'era', hint: 'Stay in this era' },
    { id: 'surprise', label: 'surprise', hint: 'Ignore the vibe — dig up something unplayed' }
  ]

  function fmt(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000))
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  function fmtLong(ms: number): string {
    const mins = Math.round(ms / 60000)
    if (mins < 60) return `${mins} min`
    return `${Math.floor(mins / 60)} hr ${mins % 60} min`
  }

  function jump(it: PlayQueueItem): void {
    void plexState.playback.skipToQueueItemId(it.playQueueItemID)
  }

  function removeGroup(group: { items: PlayQueueItem[] }): void {
    void plexState.playback.removeItemsFromQueue(group.items.map((it) => it.playQueueItemID))
  }

  function groupMs(group: { items: PlayQueueItem[] }): number {
    return group.items.reduce((sum, it) => sum + (it.duration || 0), 0)
  }

  function close(): void {
    plexState.playback.closeQueue()
  }

  function onBackdropKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
  }
</script>

{#snippet albumRow(group: QueueGroup)}
  <li class="album-row" class:dim={group.isStaged}>
    <button
      class="jump"
      onclick={() => (expandedAlbums[group.key] = !expandedAlbums[group.key])}
      title={expandedAlbums[group.key] ? 'Hide tracks' : 'Show tracks'}
    >
      {#if group.items[0].thumb}
        <img src={plexState.thumbUrl(group.items[0].thumb, 80) ?? ''} alt="" />
      {:else}
        <div class="ph"></div>
      {/if}
      <span class="meta">
        <span class="title">{group.album}</span>
        <span class="sub">
          {group.artist} · {group.items.length}
          {group.items.length === 1 ? 'track' : 'tracks'}
        </span>
      </span>
      <span class="dur">{fmtLong(groupMs(group))}</span>
      <span class="tri">{expandedAlbums[group.key] ? '▾' : '▸'}</span>
    </button>
    <button class="rowact" title="Play this album now" aria-label="Play this album now" onclick={() => jump(group.items[0])}>▶</button>
    <button
      class="rm"
      title="Remove album from queue"
      aria-label="Remove album from queue"
      onclick={() => removeGroup(group)}
    >✕</button>
  </li>
{/snippet}

{#snippet row(it: PlayQueueItem, zone: 'history' | 'current' | 'upcoming')}
  <li class={zone}>
    <button
      class="jump"
      onclick={() => zone !== 'current' && jump(it)}
      title={zone === 'current' ? undefined : 'Play from here'}
    >
      {#if it.thumb}
        <img src={plexState.thumbUrl(it.thumb, 80) ?? ''} alt="" />
      {:else}
        <div class="ph"></div>
      {/if}
      <span class="meta">
        <span class="title">{it.title}</span>
        <span class="sub">{it.artist}{it.album ? ` · ${it.album}` : ''}</span>
      </span>
      <span class="dur">{fmt(it.duration)}</span>
    </button>
    {#if zone === 'upcoming'}
      <button
        class="rm"
        title="Remove from queue"
        aria-label="Remove from queue"
        onclick={() => void plexState.playback.removeFromQueue(it.playQueueItemID)}
      >✕</button>
    {/if}
  </li>
{/snippet}

{#if plexState.playback.queueOpen}
  <div
    class="backdrop"
    role="button"
    tabindex="0"
    aria-label="Close queue"
    onclick={close}
    onkeydown={onBackdropKey}
  ></div>
  <aside class="panel" aria-label="Play queue">
    <header>
      <h2>Queue</h2>
      {#if upcoming.length > 0}
        <span class="counts">
          {groups.length}
          {groups.length === 1 ? 'record' : 'records'} up next · {fmtLong(upcomingMs)}
        </span>
        <button class="clear" onclick={() => void plexState.playback.clearUpcoming()}>
          Clear upcoming
        </button>
      {/if}
      <button class="x" onclick={close} aria-label="Close">✕</button>
    </header>

    {#if plexState.playback.queueLoading && !snap}
      <div class="empty">Loading…</div>
    {:else if plexState.playback.queueError}
      <div class="empty err">{plexState.playback.queueError}</div>
    {:else if !snap || (!current && upcoming.length === 0)}
      <div class="empty">Nothing queued.</div>
    {:else}
      <div class="scroll">
        {#if history.length > 0}
          <button class="zone-toggle" onclick={() => (historyOpen = !historyOpen)}>
            <span class="tri">{historyOpen ? '▾' : '▸'}</span>
            {history.length} played
          </button>
          {#if historyOpen}
            <ul>
              {#each history as it (it.playQueueItemID)}
                {@render row(it, 'history')}
              {/each}
            </ul>
          {/if}
        {/if}

        {#if current}
          <div class="zone-label">Now playing</div>
          <ul>
            {@render row(current, 'current')}
          </ul>
        {/if}

        {#each groups as group (group.key)}
          {#if group.isStaged}
            <div class="radio-divider">
              <span class="radio-label" title={`Radio pick: ${group.album} — ${group.artist}`}>
                ⟳ Radio · {stagedSourceLabel}
              </span>
              <button
                class="radio-act"
                title="Pick a different album"
                aria-label="Swap radio pick"
                onclick={() => void plexState.playback.radio.swap()}
              >⟳</button>
              <button
                class="radio-act"
                title="Remove — veto twice to stop after this album"
                aria-label="Veto radio pick"
                onclick={() => void plexState.playback.radio.veto()}
              >✕</button>
            </div>
            <div class="radio-steer" role="radiogroup" aria-label="Radio steering">
              {#each STEERS as s (s.id)}
                <button
                  class="steer-chip"
                  class:active={plexState.playback.radio.steer === s.id}
                  title={s.hint}
                  onclick={() => plexState.playback.radio.setSteer(s.id)}
                >{s.label}</button>
              {/each}
            </div>
            <ul class="staged">
              {@render albumRow(group)}
              {#if expandedAlbums[group.key]}
                {#each group.items as it (it.playQueueItemID)}
                  {@render row(it, 'upcoming')}
                {/each}
              {/if}
            </ul>
          {:else if group.fromCurrentAlbum}
            <!-- The record you're inside stays track-level — you jump around it. -->
            <div class="zone-label">Up next · from this album</div>
            <ul>
              {#each group.items as it (it.playQueueItemID)}
                {@render row(it, 'upcoming')}
              {/each}
            </ul>
          {:else if group.items.length === 1}
            <!-- A loose Play Next track, not a record. -->
            <ul>
              {@render row(group.items[0], 'upcoming')}
            </ul>
          {:else}
            <ul>
              {@render albumRow(group)}
              {#if expandedAlbums[group.key]}
                {#each group.items as it (it.playQueueItemID)}
                  {@render row(it, 'upcoming')}
                {/each}
              {/if}
            </ul>
          {/if}
        {/each}

        {#if plexState.playback.radio.stopAfter}
          <div class="stop-note">Stopping after this album</div>
        {/if}
      </div>
    {/if}
  </aside>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(43, 29, 18, 0.28);
    z-index: 55;
    border: 0;
    padding: 0;
  }
  .panel {
    position: fixed;
    right: 12px;
    bottom: 88px;
    width: 400px;
    /* Grow with the queue: compact when short, a full-height drawer when
       long — stopping 64px shy of the top toolbar (88px is the player bar). */
    max-height: calc(100vh - 88px - 64px);
    display: flex;
    flex-direction: column;
    /* This panel is a fixed dark surface in every theme, but its children
       color themselves with the theme's ink tokens — which are dark inks on
       the light themes (dark-on-dark, unreadable). Re-scope the tokens to
       cream inks / white tints so the same rules read on this surface. */
    --espresso: #f2ead9;
    --walnut: #e4dbc8;
    --faded: rgba(242, 234, 217, 0.58);
    --brick: #d97f60;
    --ink-tint-04: rgba(255, 255, 255, 0.06);
    --ink-tint-06: rgba(255, 255, 255, 0.09);
    --ink-tint-08: rgba(255, 255, 255, 0.13);
    --hairline: rgba(255, 255, 255, 0.14);
    --hairline-strong: rgba(255, 255, 255, 0.22);
    --surface: rgba(255, 255, 255, 0.07);
    color: var(--espresso);
    background: rgba(18, 18, 22, 0.96);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    border: 1px solid var(--ink-tint-08);
    border-radius: var(--radius-xl);
    box-shadow: 0 14px 40px rgba(43, 29, 18, 0.22);
    z-index: 60;
    animation: pop 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
    /* Without this, the flex child below never shrinks and the panel's
       content paints past max-height, down behind the player bar. */
    overflow: hidden;
  }
  @keyframes pop {
    from { transform: translateY(10px) scale(0.98); opacity: 0; }
    to { transform: translateY(0) scale(1); opacity: 1; }
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 0.9rem 0.5rem;
    border-bottom: 1px solid var(--ink-tint-06);
  }
  h2 { font-size: 0.85rem; font-weight: 600; margin: 0; letter-spacing: 0.02em; }
  .counts {
    font-size: 0.7rem;
    color: var(--faded);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .clear {
    background: transparent;
    border: 1px solid var(--ink-tint-08);
    color: var(--faded);
    font-size: 0.68rem;
    cursor: pointer;
    padding: 3px 8px;
    border-radius: var(--radius-pill);
    white-space: nowrap;
  }
  .clear:hover { background: var(--ink-tint-04); color: var(--espresso); }
  .x {
    background: transparent;
    border: 0;
    color: var(--faded);
    font-size: 0.9rem;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    margin-left: auto;
  }
  header:has(.counts) .x { margin-left: 0; }
  .x:hover { background: var(--hairline); color: var(--espresso); }
  .scroll {
    overflow-y: auto;
    flex: 1;
    /* Flex items default to min-height:auto (content size) — they won't
       shrink to let overflow-y kick in without this. */
    min-height: 0;
    padding: 0.35rem 0.35rem 0.6rem;
  }
  .zone-toggle {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    background: transparent;
    border: 0;
    color: var(--faded);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    padding: 0.45rem 0.55rem 0.25rem;
    text-align: left;
  }
  .zone-toggle:hover { color: var(--espresso); }
  .tri { font-size: 0.6rem; }
  .zone-label {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--faded);
    padding: 0.45rem 0.55rem 0.25rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    border-radius: var(--radius-md);
  }
  li:hover { background: var(--ink-tint-04); }
  li.history { opacity: 0.55; }
  li.history:hover { opacity: 0.85; }
  li.current {
    border-left: 3px solid var(--brick);
    background: var(--ink-tint-04);
  }
  li.current .jump { cursor: default; }
  .jump {
    display: grid;
    grid-template-columns: 40px 1fr auto;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0.55rem;
    background: transparent;
    border: 0;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
    min-width: 0;
  }
  li img, li .ph {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    object-fit: cover;
    background: var(--surface);
  }
  .meta { min-width: 0; display: flex; flex-direction: column; }
  .title {
    font-size: 0.85rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 0.72rem;
    color: var(--faded);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dur {
    font-size: 0.72rem;
    color: var(--faded);
    font-variant-numeric: tabular-nums;
  }
  .rm {
    background: transparent;
    border: 0;
    color: var(--faded);
    cursor: pointer;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-pill);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    margin-right: 0.4rem;
  }
  .rm:hover { background: var(--ink-tint-08); color: var(--espresso); }
  li.album-row {
    grid-template-columns: 1fr auto auto;
  }
  .album-row .jump { grid-template-columns: 40px 1fr auto auto; }
  .album-row .title { font-weight: 600; }
  .album-row .tri { font-size: 0.6rem; color: var(--faded); }
  .album-row.dim { opacity: 0.6; }
  .album-row.dim:hover { opacity: 1; }
  .rowact {
    background: transparent;
    border: 0;
    color: var(--faded);
    cursor: pointer;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-pill);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6rem;
  }
  .rowact:hover { background: var(--ink-tint-08); color: var(--brick); }
  .empty {
    padding: 1.2rem;
    color: var(--faded);
    font-size: 0.85rem;
    text-align: center;
  }
  .empty.err { color: var(--err-fg); }
  .radio-divider {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.5rem;
    padding: 0.35rem 0.55rem 0.25rem;
    border-top: 1px dashed var(--ink-tint-08);
  }
  .radio-label {
    flex: 1;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--brick);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .radio-act {
    background: transparent;
    border: 0;
    color: var(--faded);
    cursor: pointer;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-pill);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
  }
  .radio-act:hover { background: var(--ink-tint-08); color: var(--espresso); }
  .radio-steer {
    display: flex;
    gap: 0.3rem;
    padding: 0.15rem 0.55rem 0.35rem;
  }
  .steer-chip {
    background: transparent;
    border: 1px solid var(--ink-tint-08);
    color: var(--faded);
    cursor: pointer;
    font-size: 0.62rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 0.12rem 0.5rem;
    border-radius: var(--radius-pill);
  }
  .steer-chip:hover { color: var(--espresso); border-color: var(--ink-tint-16); }
  .steer-chip.active {
    color: var(--brick);
    border-color: var(--brick);
  }
  ul.staged li { opacity: 0.6; }
  ul.staged li:hover { opacity: 1; }
  .stop-note {
    padding: 0.6rem 0.55rem;
    font-size: 0.72rem;
    color: var(--faded);
    font-style: italic;
    text-align: center;
  }
</style>
