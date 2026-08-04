<script lang="ts">
  import { plexState } from './plex-state.svelte'
  import { PUBLIC_BUILD } from '../../../shared/build-flags'
  import PlayerPicker from './PlayerPicker.svelte'

  const appInfo = window.cratedigger.appInfo
  const versionLabel = appInfo.isDev ? 'dev' : `v${appInfo.version}`

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
  <PlayerPicker />
  {#if !PUBLIC_BUILD}
    <button class="secondary" onclick={() => void plexState.openInbox()}>inbox</button>
    <button class="secondary" onclick={() => void plexState.openTriage()}>triage</button>
    <button class="secondary" onclick={() => void plexState.openSlskd()}>soulseek</button>
    <button class="secondary" onclick={() => void plexState.openArtFixer()}>art fixer</button>
  {/if}
  <button class="secondary" onclick={() => void plexState.openNewReleases()}>new</button>
  <button class="secondary" onclick={() => void plexState.openShows()}>shows</button>
  <button class="secondary" onclick={() => void plexState.openCharts()}>charts</button>
  <button class="secondary" onclick={() => void plexState.openClassical()}>classical</button>
  <button class="secondary" onclick={() => void plexState.openPlaylists()}>playlists</button>
  <button class="secondary" onclick={() => void plexState.openListenLater()}>later</button>
  <button class="secondary overflow" onclick={openOverflow} aria-label="More" title="Themes, settings, account">···</button>
</div>


<style>
  .bar {
    /* Lives in its own row at the top of the app — App.svelte wraps the
       active screen below this bar. Drag the window from the empty space;
       interactive children opt out via no-drag. */
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
    -webkit-app-region: drag;
    /* backdrop-filter creates a stacking context — without an explicit
       z-index here, the toolbar's child popovers (PlayerPicker menu) lose
       to Library's sticky header (z-index 5). Keep below modals (z 1000+). */
    position: relative;
    z-index: 30;
  }
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
  .version {
    -webkit-app-region: no-drag;
    margin-right: auto;
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
