<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import { plexState } from './plex-state.svelte'
  import { PUBLIC_BUILD } from '../../../shared/build-flags'

  const open = $derived(plexState.commandPaletteOpen)

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const mod = isMac ? '⌘' : 'Ctrl'

  interface Command {
    id: string
    label: string
    category: string
    keys?: string[]
    run: () => void
  }

  // Static command set. Each row's `run` invokes a plexState method directly;
  // no IPC indirection. Order here is the order shown for an empty query.
  const commands: Command[] = [
    // — Navigation —
    { id: 'go-library',  label: 'Go to library',         category: 'Navigation', keys: [mod, '1'], run: () => plexState.goHome() },
    ...(PUBLIC_BUILD ? [] : [
    { id: 'go-inbox',    label: 'Go to inbox',           category: 'Navigation', keys: [mod, '2'], run: () => void plexState.openInbox() },
    { id: 'go-triage',   label: 'Go to triage',          category: 'Navigation', keys: [mod, '3'], run: () => void plexState.openTriage() },
    { id: 'go-slskd',    label: 'Go to Soulseek',        category: 'Navigation', keys: [mod, '4'], run: () => void plexState.openSlskd() },
    ] as Command[]),
    { id: 'go-new',      label: 'Go to new & upcoming',  category: 'Navigation', keys: [mod, '5'], run: () => void plexState.openNewReleases() },
    { id: 'go-shows',    label: 'Go to shows',           category: 'Navigation', keys: [mod, '6'], run: () => void plexState.openShows() },
    { id: 'go-later',    label: 'Go to listen later',    category: 'Navigation', keys: [mod, '7'], run: () => void plexState.openListenLater() },
    { id: 'nav-back',    label: 'Back',                  category: 'Navigation', keys: [mod, '['], run: () => void plexState.goBack() },
    { id: 'nav-forward', label: 'Forward',               category: 'Navigation', keys: [mod, ']'], run: () => void plexState.goForward() },
    // — Now Playing —
    { id: 'play-pause',  label: 'Play / pause',          category: 'Now playing', keys: ['F8'], run: () => void plexState.playback.transport(plexState.playback.timeline?.state === 'playing' ? 'pause' : 'play') },
    { id: 'next-track',  label: 'Next track',            category: 'Now playing', keys: ['F9'], run: () => void plexState.playback.transport('next') },
    { id: 'prev-track',  label: 'Previous track',        category: 'Now playing', keys: ['F7'], run: () => void plexState.playback.transport('prev') },
    { id: 'toggle-queue', label: 'Toggle queue panel',   category: 'Now playing', run: () => plexState.playback.toggleQueue() },
    { id: 'open-now-playing', label: 'Open now playing', category: 'Now playing', run: () => plexState.openNowPlaying() },
    // — Surfaces —
    { id: 'toggle-browser', label: 'Toggle browser pane', category: 'Surfaces', keys: [mod, 'B'], run: () => plexState.toggleBrowserPane() },
    { id: 'show-help',    label: 'Show keyboard shortcuts', category: 'Surfaces', keys: ['?'], run: () => (plexState.keyboardHelpOpen = true) },
    { id: 'theme-picker', label: 'Pick theme',            category: 'Surfaces', run: () => plexState.openThemePicker() },
    { id: 'open-settings', label: 'Open settings',        category: 'Surfaces', run: () => void plexState.openSettings() },
    // — Library —
    { id: 'reload-library', label: 'Reload library from Plex', category: 'Library', run: () => void plexState.reloadAllAlbums() },
    { id: 'change-server',  label: 'Change Plex server',     category: 'Library', run: () => plexState.requestChangeServer() },
    { id: 'sign-out',       label: 'Sign out',                category: 'Library', run: () => void plexState.signOut() }
  ]

  let query = $state('')
  let selectedIndex = $state(0)
  let inputEl = $state<HTMLInputElement | null>(null)
  let listEl = $state<HTMLDivElement | null>(null)

  // Auto-focus + reset query on open. $effect runs after DOM commit so the
  // input exists by the time we focus.
  $effect(() => {
    if (open) {
      query = ''
      selectedIndex = 0
      void tick().then(() => inputEl?.focus())
    }
  })

  // Ranked filter. score = lowest is best.
  //   0  → label starts with query
  //   1  → any word in label starts with query
  //   2  → substring match
  //   -1 → no match (filtered out)
  // Empty query passes everything through with rank by source order.
  function rank(label: string, q: string): number {
    if (!q) return 2
    const L = label.toLowerCase()
    if (L.startsWith(q)) return 0
    // word-start: split on non-word chars
    for (const w of L.split(/[\s/-]+/)) {
      if (w.startsWith(q)) return 1
    }
    return L.includes(q) ? 2 : -1
  }

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands.map((c, i) => ({ cmd: c, idx: i, score: 2 }))
    const scored: { cmd: Command; idx: number; score: number }[] = []
    for (let i = 0; i < commands.length; i++) {
      const s = rank(commands[i].label, q)
      if (s >= 0) scored.push({ cmd: commands[i], idx: i, score: s })
    }
    scored.sort((a, b) => a.score - b.score || a.idx - b.idx)
    return scored
  })

  // Keep the selected row in view as the list filters. Reset to 0 when the
  // current selection drops out of the filtered set.
  $effect(() => {
    const n = filtered.length
    if (n === 0) {
      selectedIndex = 0
      return
    }
    if (selectedIndex >= n) selectedIndex = 0
    queueMicrotask(() => {
      const row = listEl?.querySelector<HTMLElement>(`[data-cmd-row="${selectedIndex}"]`)
      if (row) row.scrollIntoView({ block: 'nearest' })
    })
  })

  function close(): void {
    plexState.commandPaletteOpen = false
  }

  function run(cmd: Command): void {
    close()
    // Defer so the modal unmount happens before the command might mount a
    // different modal — prevents a brief two-modal stack.
    queueMicrotask(() => cmd.run())
  }

  function onInputKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (filtered.length > 0) selectedIndex = (selectedIndex + 1) % filtered.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (filtered.length > 0) selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = filtered[selectedIndex]?.cmd
      if (hit) run(hit)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  onDestroy(() => {
    // nothing to clean up — state lives on plexState
  })
</script>

{#if open}
  <div class="backdrop" onclick={close} role="presentation">
    <div
      class="palette"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      tabindex="-1"
    >
      <input
        bind:this={inputEl}
        class="input"
        type="text"
        placeholder="Type a command…"
        bind:value={query}
        onkeydown={onInputKey}
        spellcheck="false"
        autocomplete="off"
      />
      <div class="list" bind:this={listEl}>
        {#if filtered.length === 0}
          <div class="empty">No matches</div>
        {:else}
          {#each filtered as f, i (f.cmd.id)}
            <button
              type="button"
              class="row"
              class:selected={i === selectedIndex}
              data-cmd-row={i}
              onmouseenter={() => (selectedIndex = i)}
              onclick={() => run(f.cmd)}
            >
              <span class="label">{f.cmd.label}</span>
              <span class="cat">{f.cmd.category}</span>
              {#if f.cmd.keys}
                <span class="keys">
                  {#each f.cmd.keys as k, j (j)}
                    {#if j > 0}<span class="plus">+</span>{/if}
                    <kbd>{k}</kbd>
                  {/each}
                </span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(43, 29, 18, 0.42);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
    z-index: 1300;
    animation: fade-in var(--dur-instant) var(--ease-out);
  }
  .palette {
    background: var(--paper);
    color: var(--espresso);
    border: 1px solid var(--hairline-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    width: 92%;
    max-width: 560px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: pop-in var(--dur-base) var(--ease-spring);
  }
  .input {
    appearance: none;
    border: 0;
    border-bottom: 1px solid var(--hairline);
    background: transparent;
    color: var(--espresso);
    font: inherit;
    font-size: 1rem;
    padding: 0.85rem 1rem;
    outline: none;
  }
  .input::placeholder { color: var(--faded); }
  .list {
    overflow: auto;
    padding: 0.4rem 0;
    flex: 1;
    min-height: 0;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.75rem;
    align-items: center;
    width: 100%;
    background: transparent;
    border: 0;
    color: inherit;
    text-align: left;
    font: inherit;
    padding: 0.55rem 1rem;
    cursor: pointer;
    border-left: 2px solid transparent;
  }
  .row.selected {
    background: var(--surface);
    border-left-color: var(--brick);
  }
  .label {
    font-size: 0.9rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cat {
    font-size: 0.68rem;
    color: var(--faded);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .keys {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }
  .plus { color: var(--faded); font-size: 0.7rem; }
  kbd {
    background: var(--surface-deep);
    border: 1px solid var(--hairline-strong);
    border-bottom-width: 2px;
    border-radius: var(--radius-xs);
    padding: 0.05rem 0.4rem;
    font-size: 0.7rem;
    font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    color: var(--walnut);
    min-width: 1.3em;
    text-align: center;
    line-height: 1.3;
  }
  .empty {
    padding: 1.2rem 1rem;
    text-align: center;
    color: var(--faded);
    font-size: 0.88rem;
  }
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes pop-in {
    from { transform: translateY(-6px) scale(0.98); opacity: 0; }
    to { transform: translateY(0) scale(1); opacity: 1; }
  }
</style>
