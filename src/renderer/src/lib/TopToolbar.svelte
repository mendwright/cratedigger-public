<script lang="ts">
  import { plexState, type PrimaryPlace } from './plex-state.svelte'
  import { PUBLIC_BUILD } from '../../../shared/build-flags'
  import PlayerPicker from './PlayerPicker.svelte'

  const appInfo = window.cratedigger.appInfo
  const versionLabel = appInfo.isDev ? 'dev' : `v${appInfo.version}`

  // The places you browse, in the order ⌘1–⌘7 select them (App.svelte's
  // onGlobalKey mirrors this list — keep the two in step). Maintenance screens
  // are not here; they're behind `tools` below.
  const places: { id: PrimaryPlace; label: string; go: () => void }[] = [
    { id: 'library', label: 'library', go: () => plexState.goHome() },
    { id: 'releases', label: 'new', go: () => void plexState.openNewReleases() },
    { id: 'shows', label: 'shows', go: () => void plexState.openShows() },
    { id: 'charts', label: 'charts', go: () => void plexState.openCharts() },
    { id: 'classical', label: 'classical', go: () => void plexState.openClassical() },
    { id: 'playlists', label: 'playlists', go: () => void plexState.openPlaylists() },
    { id: 'later', label: 'later', go: () => void plexState.openListenLater() }
  ]

  const place = $derived(plexState.currentPlace)

  // The four maintenance screens used to be permanent pills — four of the
  // eleven that pushed this bar onto a second row. Behind one menu they cost
  // one slot, and they're rare enough that a menu is the honest weight for
  // them. Same overflow pattern as the ··· menu.
  function openTools(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    plexState.openContextMenu(Math.round(r.right), Math.round(r.bottom + 6), [
      { label: 'Inbox', onClick: () => void plexState.openInbox() },
      { label: 'Triage', onClick: () => void plexState.openTriage() },
      { label: 'Soulseek', onClick: () => void plexState.openSlskd() },
      { label: 'Art fixer', onClick: () => void plexState.openArtFixer() }
    ])
  }

  // Rare account/app actions live behind the ··· menu instead of permanent
  // pills — keeps the toolbar to one row at the default window width.
  async function openOverflow(e: MouseEvent): Promise<void> {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const accounts = await plexState.listAccounts()
    plexState.openContextMenu(Math.round(r.right), Math.round(r.bottom + 6), [
      { label: 'Themes', onClick: () => plexState.openThemePicker() },
      { label: 'Settings', onClick: () => void plexState.openSettings() },
      { separator: true },
      ...accounts.map((a) => ({
        label: a.active ? `✓ ${a.username}` : `switch to ${a.username}`,
        disabled: a.active,
        onClick: () => void plexState.switchAccount(a.id)
      })),
      { label: 'Add account…', onClick: () => void plexState.signIn() },
      { separator: true },
      { label: 'Change server', onClick: () => plexState.requestChangeServer() },
      { label: 'Sign out', onClick: () => plexState.signOut() }
    ])
  }
</script>

<div class="bar">
  <button class="home" onclick={() => plexState.goHome()} aria-label="Home" title="Home">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="3.25" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  </button>
  <span class="version" class:dev={appInfo.isDev}>{versionLabel}</span>
  <div class="drag-fill"></div>
  <PlayerPicker />
  {#if !PUBLIC_BUILD}
    <button class="secondary" onclick={openTools}>tools ▾</button>
  {/if}
  <nav class="places" aria-label="Sections">
    {#each places as p (p.id)}
      <button
        class="place"
        class:selected={place === p.id}
        aria-current={place === p.id ? 'page' : undefined}
        onclick={p.go}
      >{p.label}</button>
    {/each}
  </nav>
  <button class="secondary overflow" onclick={openOverflow} aria-label="More" title="Themes, settings, account">···</button>
</div>


<style>
  .bar {
    /* Lives in its own row at the top of the app — App.svelte wraps the
       active screen below this bar. Drag the window from `.drag-fill`, the
       empty stretch in the middle.

       The bar itself must stay `no-drag`. It used to be `drag`, with every
       control punching a `no-drag` hole in it — but macOS caches those hole
       rects, and after a resize / fullscreen toggle they go stale, at which
       point the whole strip behaves as one drag region and every control in
       it stops responding (clicks become window-drags and never reach the
       renderer). A page reload re-sent the rects, which is why refreshing
       "fixed" it. Keeping the draggable area to one element that contains no
       controls means a stale rect can cost you a drag, never a click. */
    flex-shrink: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 0.5rem;
    /* 84px left inset clears the macOS traffic lights — titleBarStyle is
       hiddenInset, so they float over this bar at roughly x 12–64. */
    padding: 0.55rem 1.25rem 0.55rem 84px;
    background: color-mix(in srgb, var(--paper) 92%, transparent);
    backdrop-filter: blur(20px) saturate(1.1);
    -webkit-backdrop-filter: blur(20px) saturate(1.1);
    border-bottom: 1px solid var(--hairline);
    -webkit-app-region: no-drag;
    /* backdrop-filter creates a stacking context — without an explicit
       z-index here, the toolbar's child popovers (PlayerPicker menu) lose
       to Library's sticky header (z-index 5). Keep below modals (z 1000+). */
    position: relative;
    z-index: 30;
  }
  /* The primary nav reads as one object rather than seven loose pills, so the
     bar has an obvious "places" cluster and the selected one can be filled in
     without looking like a stray button. */
  .places {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    background: var(--ink-tint-06);
    border-radius: var(--radius-pill);
  }
  .place {
    -webkit-app-region: no-drag;
    background: transparent;
    border: 0;
    color: var(--walnut);
    font-size: 0.78rem;
    padding: 0.32rem 0.8rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
    white-space: nowrap;
    transition: color 140ms ease, background 140ms ease;
  }
  .place:hover { color: var(--espresso); }
  .place.selected {
    background: var(--espresso);
    color: var(--surface);
    font-weight: 600;
  }
  .place:active { transform: scale(0.97); }
  .secondary {
    -webkit-app-region: no-drag;
    background: transparent;
    color: var(--walnut);
    border: 1px solid var(--hairline);
    padding: 0.36rem 0.85rem;
    border-radius: var(--radius-pill);
    font-size: 0.76rem;
    cursor: pointer;
    transition: color 140ms ease, border-color 140ms ease, background 140ms ease, transform 80ms ease;
  }
  .secondary:hover {
    color: var(--espresso);
    border-color: var(--hairline-strong);
    background: var(--surface);
  }
  .secondary:active { transform: scale(0.97); }
  .overflow {
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 0.36rem 0.6rem;
  }
  .home {
    -webkit-app-region: no-drag;
    background: transparent;
    border: 0;
    padding: 0.15rem;
    color: var(--walnut);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-pill);
    transition: color 140ms ease, transform 140ms ease;
  }
  .home:hover {
    color: var(--brick);
    transform: rotate(30deg);
  }
  .home:active {
    transform: rotate(30deg) scale(0.92);
  }
  /* The only draggable surface in the bar. Holds no children, and — the part
     that matters — never changes size or position.

     This used to be `flex: 1 1 auto`, absorbing the slack between the version
     pill and the right-hand controls. That made it the most size-variable
     element in the bar, which is fatal here: macOS caches drag rects, and the
     cached rect from a wider window extends further right than the live
     element does, straight over PlayerPicker and the pills sitting next to it.
     Shrinking the window or leaving fullscreen would leave the top buttons
     dead until a reload re-emitted the rects. Moving the drag region onto one
     element (ce361a4) didn't fix that — it just replaced thirteen small stale
     rects with one large one that travels further.

     So: fixed width, no grow, no shrink, left-anchored behind the version
     pill. `margin-right: auto` absorbs the slack as *margin*, which emits no
     rect of its own, so the right-hand controls still sit at the right edge.
     The handle's box is identical at every window width and in fullscreen, so
     a stale rect is byte-for-byte the live one and can never cover a control.
     Cost: you drag from this strip rather than the whole middle of the bar.
     Don't reintroduce a flexible width here. */
  .drag-fill {
    -webkit-app-region: drag;
    flex: 0 0 180px;
    margin-right: auto;
    align-self: stretch;
  }
  .version {
    -webkit-app-region: no-drag;
    padding: 0.2rem 0.55rem;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    color: var(--faded);
    background: var(--ink-tint-06);
    border-radius: var(--radius-pill);
    letter-spacing: 0.02em;
  }
  .version.dev {
    color: var(--brick);
    background: var(--brick-wash);
    text-transform: uppercase;
    font-weight: 600;
  }
</style>
