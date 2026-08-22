<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { plexState } from './lib/plex-state.svelte'
  import { PUBLIC_BUILD } from '../../shared/build-flags'
  import { installSwipeNav } from './lib/swipe-nav'
  import { startFreezeDiag, dumpDiag } from './lib/freeze-diag' // [freeze-diag]
  import SignIn from './screens/SignIn.svelte'
  import ServerPicker from './screens/ServerPicker.svelte'
  import Library from './screens/Library.svelte'
  import AlbumDetail from './screens/AlbumDetail.svelte'
  import NowPlayingScreen from './screens/NowPlayingScreen.svelte'
  import TheaterMode from './screens/TheaterMode.svelte'
  import Entity from './screens/Entity.svelte'
  import LabelEntity from './screens/LabelEntity.svelte'
  import GenreEntity from './screens/GenreEntity.svelte'
  import YearEntity from './screens/YearEntity.svelte'
  import InboxView from './screens/InboxView.svelte'
  import Triage from './screens/Triage.svelte'
  import SlskdSearch from './screens/SlskdSearch.svelte'
  import NewReleases from './screens/NewReleases.svelte'
  import ListenLater from './screens/ListenLater.svelte'
  import Shows from './screens/Shows.svelte'
  import Charts from './screens/Charts.svelte'
  import Classical from './screens/Classical.svelte'
  import Playlists from './screens/Playlists.svelte'
  import ArtFixer from './screens/ArtFixer.svelte'
  import NowPlaying from './lib/NowPlaying.svelte'
  import QueuePanel from './lib/QueuePanel.svelte'
  import LabelFilter from './lib/LabelFilter.svelte'
  import GenreFilter from './lib/GenreFilter.svelte'
  import DecadeFilter from './lib/DecadeFilter.svelte'
  import ContextMenu from './lib/ContextMenu.svelte'
  import ManualMatchModal from './lib/ManualMatchModal.svelte'
  import AddToPlaylistModal from './lib/AddToPlaylistModal.svelte'
  import CoverPickerModal from './lib/CoverPickerModal.svelte'
  import SlskdReleasePicker from './lib/SlskdReleasePicker.svelte'
  import SettingsModal from './lib/SettingsModal.svelte'
  import ThemePicker from './lib/ThemePicker.svelte'
  import TopToolbar from './lib/TopToolbar.svelte'
  import UpdateBanner from './lib/UpdateBanner.svelte'
  import BrowserPane from './lib/BrowserPane.svelte'
  import KeyboardHelp from './lib/KeyboardHelp.svelte'
  import CommandPalette from './lib/CommandPalette.svelte'

  let detachSwipe: (() => void) | null = null

  onMount(() => {
    void plexState.init()
    detachSwipe = installSwipeNav({
      onBack: () => void plexState.goBack(),
      onForward: () => void plexState.goForward()
    })
    startFreezeDiag() // [freeze-diag] passive instrumentation; remove with the rest after the freeze bug is fixed
  })
  onDestroy(() => {
    plexState.dispose()
    detachSwipe?.()
  })

  const session = $derived(plexState.session)
  const loading = $derived(session === null)
  const inLibrary = $derived(
    session?.signedIn && !!session.preferredServerId && !plexState.changingServer
  )
  const hasAlbumOpen = $derived(
    !!plexState.openAlbumLoader.album ||
      plexState.openAlbumLoader.albumLoading ||
      !!plexState.openAlbumLoader.albumError
  )
  const hasEntityOpen = $derived(!!plexState.entityPage.entity || plexState.entityPage.loading)
  const navTop = $derived(plexState.nav.stack.at(-1)?.entity ?? null)
  const filterEntity = $derived(
    navTop && (navTop.kind === 'label' || navTop.kind === 'genre' || navTop.kind === 'year')
      ? navTop
      : null
  )

  $effect(() => {
    document.body.classList.toggle('has-now-playing', !!plexState.playback.timeline)
  })

  // Global key handler. Skips when the user is typing into an input or
  // contenteditable so it doesn't fight text-edit keybindings. Keys *inside*
  // the embedded <webview> stay in that sub-renderer and don't reach here.
  function isTextTarget(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null
    if (!t) return false
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
  }

  function onGlobalKey(e: KeyboardEvent): void {
    const cmd = e.metaKey || e.ctrlKey
    const inText = isTextTarget(e)

    // [freeze-diag] Cmd+Shift+D: dump diagnostic snapshot when the freeze hits.
    // Note: if the renderer event loop is fully wedged this binding won't run
    // either — in that case run `__cratediggerDiag()` from DevTools, or just
    // observe accumulated `[freeze-diag] frame gap` warnings in the console.
    if (cmd && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault()
      dumpDiag()
      return
    }

    // Cmd+Shift+P or Cmd+.: command palette. Works even when a text input
    // is focused (palette gets focus next, taking the user out of text-mode
    // intentionally). The palette owns its own Escape handling.
    if (cmd && ((e.shiftKey && (e.key === 'p' || e.key === 'P')) || e.key === '.')) {
      e.preventDefault()
      plexState.commandPaletteOpen = !plexState.commandPaletteOpen
      return
    }

    // Cmd+T: theater mode — full-bleed cover + synced lyrics + track credits.
    if (cmd && !e.shiftKey && (e.key === 't' || e.key === 'T')) {
      if (inText) return
      e.preventDefault()
      if (plexState.theaterOpen) plexState.closeTheater()
      else plexState.openTheater()
      return
    }

    // Cmd+Shift+M: toggle the mini-player window.
    if (cmd && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
      if (inText) return
      e.preventDefault()
      void window.cratedigger.mini.toggle()
      return
    }

    // Cmd+B: toggle the in-app browser pane.
    if (cmd && (e.key === 'b' || e.key === 'B')) {
      if (inText) return
      e.preventDefault()
      plexState.toggleBrowserPane()
      return
    }

    // Cmd+[ / Cmd+]: browser-style history nav across navStack.
    if (cmd && e.key === '[') {
      if (inText) return
      e.preventDefault()
      void plexState.goBack()
      return
    }
    if (cmd && e.key === ']') {
      if (inText) return
      e.preventDefault()
      void plexState.goForward()
      return
    }

    // ? (Shift+/): toggle the keyboard-shortcut help overlay. Esc closes
    // the overlay (handled inside the modal via window keydown — TODO when
    // the global Esc stack lands).
    if (!cmd && (e.key === '?' || (e.key === '/' && e.shiftKey))) {
      if (inText) return
      e.preventDefault()
      plexState.keyboardHelpOpen = !plexState.keyboardHelpOpen
      return
    }
    if (e.key === 'Escape' && plexState.keyboardHelpOpen) {
      plexState.keyboardHelpOpen = false
      return
    }

    // Cmd+1..7: the toolbar's primary nav, in the order it's drawn. These used
    // to be numbered by an older toolbar order in which ⌘2–4 were maintenance
    // screens and two visible destinations (playlists, classical) had no
    // shortcut at all — you couldn't learn the bindings by looking at the bar.
    // Keep this list in step with TopToolbar's `places`. 8 and 9 stay unbound.
    if (cmd && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      if (inText) return
      e.preventDefault()
      switch (e.key) {
        case '1': plexState.goHome(); break
        case '2': void plexState.openNewReleases(); break
        case '3': void plexState.openShows(); break
        case '4': void plexState.openCharts(); break
        case '5': void plexState.openClassical(); break
        case '6': void plexState.openPlaylists(); break
        case '7': void plexState.openListenLater(); break
      }
      return
    }

    // Cmd+Shift+1..4: the maintenance screens, now behind the toolbar's `tools`
    // menu. Matched on e.code because shifted digits report as punctuation
    // (`!`, `@`, …) in e.key.
    if (cmd && e.shiftKey && !e.altKey && !PUBLIC_BUILD) {
      if (inText) return
      switch (e.code) {
        case 'Digit1': e.preventDefault(); void plexState.openInbox(); return
        case 'Digit2': e.preventDefault(); void plexState.openTriage(); return
        case 'Digit3': e.preventDefault(); void plexState.openSlskd(); return
        case 'Digit4': e.preventDefault(); void plexState.openArtFixer(); return
      }
    }
  }
</script>

<svelte:window onkeydown={onGlobalKey} />

{#if loading}
  <div class="boot">…</div>
{:else if !session?.signedIn}
  <SignIn />
{:else if !inLibrary}
  <ServerPicker />
{:else}
  <div class="shell">
    <TopToolbar />
    <div class="shell-body">
      <main class="screen">
        {#if plexState.nowPlayingOpen}
          <NowPlayingScreen />
        {:else if hasEntityOpen}
          <Entity />
        {:else if hasAlbumOpen}
          <AlbumDetail />
        {:else if filterEntity?.kind === 'label'}
          <LabelEntity name={filterEntity.name} />
        {:else if filterEntity?.kind === 'genre'}
          <GenreEntity name={filterEntity.name} />
        {:else if filterEntity?.kind === 'year'}
          <YearEntity year={filterEntity.year} />
        {:else if !PUBLIC_BUILD && plexState.view === 'inbox'}
          <InboxView />
        {:else if !PUBLIC_BUILD && plexState.view === 'triage'}
          <Triage />
        {:else if !PUBLIC_BUILD && plexState.view === 'slskd'}
          <SlskdSearch />
        {:else if plexState.view === 'releases'}
          <NewReleases />
        {:else if plexState.view === 'later'}
          <ListenLater />
        {:else if plexState.view === 'shows'}
          <Shows />
        {:else if plexState.view === 'charts'}
          <Charts />
        {:else if plexState.view === 'classical'}
          <Classical />
        {:else if plexState.view === 'playlists'}
          <Playlists />
        {:else if !PUBLIC_BUILD && plexState.view === 'artfix'}
          <ArtFixer />
        {:else}
          <Library />
        {/if}
      </main>
      {#if plexState.browserPaneOpen}
        <BrowserPane />
      {/if}
    </div>
  </div>
{/if}

{#if plexState.theaterOpen}
  <TheaterMode />
{/if}
<NowPlaying />
<QueuePanel />
<LabelFilter />
<GenreFilter />
<DecadeFilter />
<ContextMenu />
<ManualMatchModal />
<AddToPlaylistModal />
<CoverPickerModal />
<SlskdReleasePicker />
<SettingsModal />
<ThemePicker />
<KeyboardHelp />
<CommandPalette />

<UpdateBanner />

{#if plexState.shows.newShowsBanner.length > 0}
  {@const matches = plexState.shows.newShowsBanner}
  <div class="shows-banner">
    <button
      class="shows-banner-main"
      onclick={() => void plexState.openShows({ focusNew: true })}
      title="Open Shows"
    >
      <span class="shows-banner-icon">🎵</span>
      <span class="shows-banner-text">
        {#if matches.length === 1}
          <strong>{matches[0].artistName}</strong> just announced a show — {matches[0].date} · {matches[0]
            .venueName}
        {:else}
          <strong>{matches.length} library artists</strong> announced shows at your venues
        {/if}
      </span>
    </button>
    <button
      class="shows-banner-dismiss"
      onclick={() => plexState.shows.dismissBanner()}
      aria-label="Dismiss"
    >
      ✕
    </button>
  </div>
{/if}

{#if plexState.castToast}
  <div class="toast" class:err={plexState.castToast.kind === 'err'}>
    {plexState.castToast.text}
  </div>
{/if}

<style>
  .boot {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--faded);
  }
  .shell {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .shell-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: row;
    min-width: 0;
  }
  .screen {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .screen > :global(*) {
    flex: 1;
    min-height: 0;
  }
  .toast {
    position: fixed;
    bottom: 1.25rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--surface);
    border: 1px solid var(--hairline);
    color: var(--espresso);
    padding: 0.55rem 1rem;
    border-radius: var(--radius-pill);
    font-size: 0.85rem;
    box-shadow: var(--shadow-md);
    z-index: 100;
    max-width: 70ch;
    text-align: center;
    animation: toast-in 160ms ease-out;
  }
  .toast.err { border-color: var(--warn-border); color: var(--warn-fg); background: var(--warn-bg); }
  @keyframes toast-in {
    from { opacity: 0; transform: translate(-50%, 8px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }

  .shows-banner {
    position: fixed;
    top: 1rem;
    right: 1rem;
    display: flex;
    align-items: stretch;
    gap: 0.25rem;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-md);
    z-index: 120;
    max-width: 42ch;
    overflow: hidden;
    animation: shows-banner-in 200ms ease-out;
  }
  .shows-banner-main {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.7rem 0.85rem;
    background: transparent;
    border: none;
    color: var(--espresso);
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;
  }
  .shows-banner-main:hover { background: var(--ink-tint-06); }
  .shows-banner-icon { font-size: 1.1rem; line-height: 1; }
  .shows-banner-text { line-height: 1.3; }
  .shows-banner-dismiss {
    background: transparent;
    border: none;
    border-left: 1px solid var(--hairline);
    color: var(--faded);
    padding: 0 0.7rem;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .shows-banner-dismiss:hover { color: var(--espresso); }
  @keyframes shows-banner-in {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
