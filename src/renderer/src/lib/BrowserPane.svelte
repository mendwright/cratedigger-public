<script lang="ts">
  import { plexState } from './plex-state.svelte'
  import { PUBLIC_BUILD } from '../../../shared/build-flags'
  import { aoty } from './browser-adapters/aoty'

  // Electron's <webview> tag exposes methods not in lib.dom. Cast through this
  // minimal interface so svelte-check stays clean without pulling in the full
  // electron types (which would bloat the renderer bundle).
  interface ElectronWebview extends HTMLElement {
    src: string
    loadURL: (url: string) => Promise<void>
    getURL: () => string
    goBack: () => void
    goForward: () => void
    reload: () => void
    canGoBack: () => boolean
    canGoForward: () => boolean
    executeJavaScript: (code: string) => Promise<unknown>
    setUserAgent: (ua: string) => void
  }

  const HOME = 'https://www.albumoftheyear.org/'
  // Stock Chrome UA. Default Electron UA gets 403'd by Cloudflare on some
  // sites (Discogs, Pitchfork). AOTY accepts both but no reason to flag the
  // request as Electron when we don't have to.
  const UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

  // bind:this gives us HTMLElement; we re-derive a typed alias for the
  // Electron-specific methods so call sites stay clean.
  let webviewRaw = $state<HTMLElement | null>(null)
  const webviewEl = $derived(webviewRaw as unknown as ElectronWebview | null)
  // User-resizable pane width. Persisted across launches in localStorage.
  // Clamped on read so a corrupted value can't push the pane offscreen.
  const WIDTH_KEY = 'cratedigger:browserPaneWidth'
  const WIDTH_MIN = 320
  const WIDTH_MAX = 1100
  const WIDTH_DEFAULT = 420
  function loadInitialWidth(): number {
    try {
      const raw = window.localStorage.getItem(WIDTH_KEY)
      if (!raw) return WIDTH_DEFAULT
      const n = parseInt(raw, 10)
      if (!Number.isFinite(n)) return WIDTH_DEFAULT
      return Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, n))
    } catch {
      return WIDTH_DEFAULT
    }
  }
  let paneWidth = $state(loadInitialWidth())
  let dragging = $state(false)
  let dragStartX = 0
  let dragStartWidth = 0
  function onResizeStart(e: PointerEvent): void {
    e.preventDefault()
    dragging = true
    dragStartX = e.clientX
    dragStartWidth = paneWidth
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onResizeMove(e: PointerEvent): void {
    if (!dragging) return
    // Pane is on the right edge → dragging the handle LEFT (negative delta)
    // makes the pane wider.
    const dx = dragStartX - e.clientX
    paneWidth = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, dragStartWidth + dx))
  }
  function onResizeEnd(e: PointerEvent): void {
    if (!dragging) return
    dragging = false
    try {
      window.localStorage.setItem(WIDTH_KEY, String(paneWidth))
    } catch {
      // localStorage full / disabled — width still applies for this session
    }
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }
  // The webview's initial src — picks up any queued navTo at mount time so
  // there's no race between Chromium's initial load and our follow-up
  // loadURL call. Subsequent navigations (pane already open) use loadURL.
  const initialSrc = (() => {
    const pending = plexState.browserPaneNavTo
    if (pending) {
      plexState.browserPaneNavTo = null
      return decodeUrlEntities(pending)
    }
    return HOME
  })()
  let urlInput = $state(initialSrc)
  let canGoBack = $state(false)
  let canGoForward = $state(false)
  let lookupBusy = $state(false)
  let toast = $state<string | null>(null)
  let toastTimer: number | null = null

  // Many venue pages emit hrefs with HTML-encoded ampersands (`&amp;`) in the
  // raw attribute string. Chromium accepts those as part of a URL, but it
  // treats `&amp;REFID=...` as a literal query key, which has surprised us
  // before. Strip the encoding so the URL behaves like the user expects.
  function decodeUrlEntities(url: string): string {
    return url.replace(/&amp;/g, '&')
  }

  function flash(text: string): void {
    toast = text
    if (toastTimer !== null) window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => {
      toast = null
      toastTimer = null
    }, 3000)
  }

  $effect(() => {
    const el = webviewEl
    if (!el) return
    el.setUserAgent?.(UA)
    const onNav = (): void => {
      try {
        urlInput = el.getURL?.() ?? urlInput
        canGoBack = el.canGoBack?.() ?? false
        canGoForward = el.canGoForward?.() ?? false
      } catch {
        // webview not ready yet
      }
    }
    el.addEventListener('did-navigate', onNav)
    el.addEventListener('did-navigate-in-page', onNav)
    el.addEventListener('did-finish-load', onNav)
    el.addEventListener('dom-ready', onNav)
    return () => {
      el.removeEventListener('did-navigate', onNav)
      el.removeEventListener('did-navigate-in-page', onNav)
      el.removeEventListener('did-finish-load', onNav)
      el.removeEventListener('dom-ready', onNav)
    }
  })

  // Post-mount nav requests: pane is already open, user clicks another
  // ticket / link. The webview is alive, so loadURL works directly —
  // Chromium handles preempting an in-flight initial load if needed.
  // Mount-time navTo was already consumed by initialSrc.
  $effect(() => {
    const target = plexState.browserPaneNavTo
    if (!target) return
    const el = webviewEl
    if (!el) return
    plexState.browserPaneNavTo = null
    navigate(decodeUrlEntities(target))
  })

  function navigate(url: string): void {
    if (!url) return
    // Require an absolute URL. Relative paths like `/event/...` would
    // otherwise get a junk "https:/event/..." that 404s silently.
    let target = url.trim()
    if (!/^https?:\/\//i.test(target)) {
      if (!target.includes('://') && !target.startsWith('//')) {
        target = `https://${target}`
      }
    }
    const el = webviewEl
    if (!el) {
      flash('Browser pane not ready yet — try again in a moment.')
      return
    }
    void el.loadURL(target).catch((err) => {
      console.warn('[browser-pane] loadURL failed', target, err)
      flash(`Could not load ${target}`)
    })
  }

  function onUrlSubmit(e: SubmitEvent): void {
    e.preventDefault()
    const v = urlInput.trim()
    if (v) navigate(v)
  }

  // Parse "Artist - Album" / "Artist – Album" / "Artist : Album" forms from a
  // selection. Anything that doesn't split cleanly gets sent as both fields
  // (slskd matching is forgiving on either side being weak).
  function splitSelection(sel: string): { artist: string; album: string } {
    const m = /^(.+?)\s+[-–—:|]\s+(.+)$/.exec(sel)
    if (m) return { artist: m[1].trim(), album: m[2].trim() }
    return { artist: sel, album: sel }
  }

  async function sendToSoulseek(): Promise<void> {
    if (!webviewEl) return
    lookupBusy = true
    try {
      const url: string = webviewEl.getURL?.() ?? ''
      let artist: string | null = null
      let album: string | null = null

      // First try the per-site adapter (currently AOTY-only). When the user
      // is on an album page, this works without any text selection.
      if (aoty.match(url)) {
        try {
          const r = (await webviewEl.executeJavaScript(aoty.extractScript)) as
            | { artist?: string; album?: string }
            | null
          if (r?.artist && r?.album) {
            artist = r.artist
            album = r.album
          }
        } catch {
          // adapter failed — fall through to selection
        }
      }

      // Fall back to whatever the user has highlighted on the page.
      if (!artist || !album) {
        try {
          const raw = (await webviewEl.executeJavaScript(
            'window.getSelection() ? window.getSelection().toString() : ""'
          )) as string
          const sel = (raw ?? '').trim()
          if (sel) {
            const split = splitSelection(sel)
            artist = split.artist
            album = split.album
          }
        } catch {
          // selection JS failed — leave nulls
        }
      }

      if (!artist || !album) {
        flash('Select album text on the page, or open an AOTY album page first.')
        return
      }

      plexState.slskd.searchSoulseekFor(artist, album)
    } finally {
      lookupBusy = false
    }
  }

  function close(): void {
    plexState.toggleBrowserPane(false)
  }
</script>

<aside class="browser-pane" style="width: {paneWidth}px;">
  <!-- Resize handle on the LEFT edge (pane lives on the right of the app). -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="resize-handle"
    class:dragging
    onpointerdown={onResizeStart}
    onpointermove={onResizeMove}
    onpointerup={onResizeEnd}
    onpointercancel={onResizeEnd}
    aria-hidden="true"
  ></div>
  <div class="chrome">
    <button class="nav" disabled={!canGoBack} onclick={() => webviewEl?.goBack?.()} title="Back" aria-label="Back">‹</button>
    <button class="nav" disabled={!canGoForward} onclick={() => webviewEl?.goForward?.()} title="Forward" aria-label="Forward">›</button>
    <button class="nav" onclick={() => webviewEl?.reload?.()} title="Reload" aria-label="Reload">⟳</button>
    <button class="nav" onclick={() => navigate(HOME)} title="Home (AOTY)" aria-label="Home">⌂</button>
    <form onsubmit={onUrlSubmit} class="url-form">
      <input
        class="url"
        type="text"
        bind:value={urlInput}
        placeholder="albumoftheyear.org/album/…"
        spellcheck="false"
        autocomplete="off"
      />
    </form>
    <button class="nav close" onclick={close} title="Close (⌘B)" aria-label="Close">×</button>
  </div>

  <div class="webview-wrap">
    <!-- svelte-ignore element_invalid_self_closing_tag -->
    <webview
      bind:this={webviewRaw}
      src={initialSrc}
      partition="persist:cratedigger-browser"
      allowpopups={true}
    ></webview>
  </div>

  {#if !PUBLIC_BUILD}
    <div class="actions">
      <button class="slskd-btn" disabled={lookupBusy} onclick={() => void sendToSoulseek()}>
        {lookupBusy ? 'Searching Soulseek…' : '▶ Search Soulseek for this album'}
      </button>
      <span class="hint">Select album text on the page, or open an AOTY album.</span>
    </div>
  {/if}

  {#if toast}
    <div class="pane-toast">{toast}</div>
  {/if}
</aside>

<style>
  .browser-pane {
    /* width is inline-styled from $state — see paneWidth in the script */
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    background: var(--surface-deep);
    border-left: 1px solid var(--hairline);
    min-height: 0;
    position: relative;
  }
  /* Thin column on the LEFT edge of the pane. 4px-wide hot zone with a
     col-resize cursor; widens to a brick accent when actively dragging. */
  .resize-handle {
    position: absolute;
    top: 0;
    left: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 4;
    background: transparent;
    transition: background var(--dur-instant) var(--ease-out);
  }
  .resize-handle:hover,
  .resize-handle.dragging {
    background: var(--brick);
    opacity: 0.4;
  }
  .chrome {
    display: flex;
    gap: 0.2rem;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--hairline);
    align-items: center;
  }
  .nav {
    background: transparent;
    border: none;
    color: var(--walnut);
    font-size: 1rem;
    line-height: 1;
    padding: 0.3rem 0.5rem;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background 120ms, color 120ms;
  }
  .nav:hover:not(:disabled) {
    background: var(--surface);
    color: var(--espresso);
  }
  .nav:disabled { opacity: 0.3; cursor: default; }
  .url-form { flex: 1; }
  .url {
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: 0.35rem 0.6rem;
    font-size: 0.78rem;
    color: var(--espresso);
    font-family: inherit;
  }
  .url:focus {
    outline: none;
    border-color: var(--walnut);
  }
  .webview-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .webview-wrap webview {
    flex: 1;
    width: 100%;
    height: 100%;
  }
  .actions {
    padding: 0.6rem 0.5rem 0.7rem;
    border-top: 1px solid var(--hairline);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .slskd-btn {
    background: var(--brick);
    color: var(--inset);
    border: none;
    padding: 0.55rem;
    font-size: 0.82rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-family: inherit;
    transition: opacity 120ms;
  }
  .slskd-btn:disabled { opacity: 0.6; cursor: default; }
  .hint {
    font-size: 0.7rem;
    color: var(--faded);
    text-align: center;
  }
  .pane-toast {
    position: absolute;
    bottom: 4.5rem;
    left: 0.75rem;
    right: 0.75rem;
    background: var(--warn-bg);
    color: var(--warn-fg);
    border: 1px solid var(--warn-border);
    padding: 0.45rem 0.7rem;
    font-size: 0.75rem;
    border-radius: var(--radius-sm);
    text-align: center;
  }
</style>
