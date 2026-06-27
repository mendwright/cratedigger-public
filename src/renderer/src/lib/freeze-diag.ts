// [freeze-diag] Temporary diagnostic instrumentation for the
// "after tens of minutes all clicks stop working" bug. Renderer-only — the bug
// vanishes on Cmd+R (renderer reload), which rules out the main process.
//
// What this captures:
//   1. rAF heartbeat. Records gap between consecutive frames; gaps > 200 ms
//      hint at a wedged event loop (hypothesis #2). If the renderer is fully
//      blocked, rAF stops firing — when it resumes (briefly, or post-reload)
//      console.warn entries flush, so even a frozen window leaves footprints.
//   2. Capture-phase `mousedown` listener. Records the target the user aimed
//      at AND the top three `elementsFromPoint(x, y)` — if a hidden modal
//      backdrop is swallowing clicks (hypothesis #1) this will name it.
//   3. Snapshot of every plexState modal/overlay flag at click time, so we
//      can correlate "I clicked here" with "X modal was open."
//
// Dump on demand:
//   - Cmd+Shift+D (wired in App.svelte)
//   - or `__cratediggerDiag()` in DevTools console
// Both write the same JSON to the console AND download a `freeze-diag-*.json`
// for sharing.
//
// Cleanup when the bug is fixed: `rg "\[freeze-diag\]"` and delete the matches.

import { plexState } from './plex-state.svelte'

type FrameGap = { at: number; gap: number }

type ClickProbe = {
  at: number
  target: string
  topAtPoint: string[]
  modals: Record<string, boolean>
  documentHidden: boolean
  hasFocus: boolean
}

const MAX_FRAMES = 600 // ~10 s @ 60fps
const MAX_GAPS = 100
const MAX_CLICKS = 50
const GAP_THRESHOLD_MS = 200

const frames: FrameGap[] = []
const gaps: FrameGap[] = []
const clicks: ClickProbe[] = []

let lastFrameAt = 0
let started = false

function describe(el: Element | null | undefined): string {
  if (!el) return '<null>'
  const tag = el.tagName.toLowerCase()
  const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : ''
  const cls = Array.from(el.classList).slice(0, 3).map((c) => `.${c}`).join('')
  return `${tag}${id}${cls}`
}

// Snapshot of every overlay/modal-open flag in plexState. Names track the
// actual fields verified in plex-state.svelte.ts + the child controllers.
function modalSnapshot(): Record<string, boolean> {
  const ps = plexState as unknown as {
    contextMenu: unknown
    manualMatch: { current: unknown }
    coverArt: { picker: unknown }
    slskd: { releasePicker: unknown }
    playback: { queueOpen: boolean }
    settings: { open: boolean }
    themePickerOpen: boolean
    keyboardHelpOpen: boolean
    commandPaletteOpen: boolean
    nowPlayingOpen: boolean
    browserPaneOpen: boolean
    labelFilterOpen: boolean
    genreFilterOpen: boolean
    decadeFilterOpen: boolean
    castToast: unknown
  }
  return {
    contextMenu: !!ps.contextMenu,
    manualMatch: !!ps.manualMatch?.current,
    coverPicker: !!ps.coverArt?.picker,
    slskdReleasePicker: !!ps.slskd?.releasePicker,
    settings: !!ps.settings?.open,
    themePicker: !!ps.themePickerOpen,
    keyboardHelp: !!ps.keyboardHelpOpen,
    commandPalette: !!ps.commandPaletteOpen,
    nowPlaying: !!ps.nowPlayingOpen,
    browserPane: !!ps.browserPaneOpen,
    labelFilter: !!ps.labelFilterOpen,
    genreFilter: !!ps.genreFilterOpen,
    decadeFilter: !!ps.decadeFilterOpen,
    queue: !!ps.playback?.queueOpen,
    castToast: !!ps.castToast
  }
}

function tick(now: number): void {
  if (lastFrameAt > 0) {
    const gap = now - lastFrameAt
    frames.push({ at: now, gap })
    if (frames.length > MAX_FRAMES) frames.shift()
    if (gap > GAP_THRESHOLD_MS) {
      const entry = { at: now, gap }
      gaps.push(entry)
      if (gaps.length > MAX_GAPS) gaps.shift()
      // Loud during the freeze window — if the loop unsticks even briefly,
      // these accumulate in the console with timestamps.
      console.warn(`[freeze-diag] frame gap ${Math.round(gap)}ms`, modalSnapshot())
    }
  }
  lastFrameAt = now
  requestAnimationFrame(tick)
}

function onMouseDown(e: MouseEvent): void {
  // Capture phase so we see clicks even if a stuck overlay would stop
  // propagation in bubble phase.
  const target = e.target as Element | null
  const stack = document.elementsFromPoint(e.clientX, e.clientY).slice(0, 3)
  const probe: ClickProbe = {
    at: performance.now(),
    target: describe(target),
    topAtPoint: stack.map(describe),
    modals: modalSnapshot(),
    documentHidden: document.hidden,
    hasFocus: document.hasFocus()
  }
  clicks.push(probe)
  if (clicks.length > MAX_CLICKS) clicks.shift()
  // If the top element under the cursor is a known overlay surface, that's
  // exactly the smoking gun we're hunting for.
  const top = probe.topAtPoint[0] ?? ''
  if (top.includes('.backdrop') || top.includes('.menu')) {
    console.warn('[freeze-diag] click landed on overlay surface', probe)
  }
}

export function startFreezeDiag(): void {
  if (started) return
  started = true
  requestAnimationFrame(tick)
  window.addEventListener('mousedown', onMouseDown, true)
  ;(window as unknown as { __cratediggerDiag: () => unknown }).__cratediggerDiag = dumpDiag
  console.log(
    '[freeze-diag] active. Press Cmd+Shift+D when the freeze hits, or run __cratediggerDiag() in the DevTools console.'
  )
}

export function dumpDiag(): unknown {
  const snapshot = {
    capturedAt: new Date().toISOString(),
    now: performance.now(),
    lastFrameAt,
    sinceLastFrameMs: lastFrameAt > 0 ? performance.now() - lastFrameAt : null,
    gaps: [...gaps],
    recentFrames: frames.slice(-120),
    clicks: [...clicks],
    modalsNow: modalSnapshot(),
    documentHidden: document.hidden,
    hasFocus: document.hasFocus(),
    // Chrome-only perf hook; absent in some embedders.
    memory: (performance as unknown as { memory?: unknown }).memory ?? null
  }
  console.log('[freeze-diag] DUMP', snapshot)
  try {
    const text = JSON.stringify(snapshot, null, 2)
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `freeze-diag-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (err) {
    console.error('[freeze-diag] dump file write failed', err)
  }
  return snapshot
}
