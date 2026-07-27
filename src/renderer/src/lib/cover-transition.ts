// Coordinates the single shared `album-cover-active` view-transition that backs
// the card -> album-detail cover morph (see AlbumCard.handleClick + the
// AlbumViewShell hero). The name is a *singleton*, so two rules must hold:
//
//  1. Only one morph runs at a time. Firing a second startViewTransition while
//     one is mid-flight makes Chromium resolve the name collision by leaving a
//     snapshot painted on the top layer.
//  2. An in-flight morph MUST be force-finished before navigation swaps the
//     screen out from under it. The card->detail morph runs for --dur-base
//     (220ms); if the user hits back/swipe within that window the whole screen
//     unmounts mid-transition and Chromium can strand the snapshot — a cover
//     then renders oversized/stuck over the grid until the next reflow.
//
// This module is the one place that owns the active transition so AlbumCard can
// register it and the nav/close path can flush it.

interface ViewTransitionLike {
  finished?: Promise<unknown>
  skipTransition?: () => void
}

let active: ViewTransitionLike | null = null
let watchdog: ReturnType<typeof setTimeout> | null = null

// The morph runs for --dur-base (220ms). If `.finished` hasn't settled well
// past that the transition is wedged (the screen was swapped out from under it
// by a nav path we didn't explicitly flush) — force it to end so the snapshot
// can't linger. Generous margin so a merely-janky frame isn't cut short.
const WATCHDOG_MS = 600

function clearWatchdog(): void {
  if (watchdog !== null) {
    clearTimeout(watchdog)
    watchdog = null
  }
}

/** True while a cover morph is animating — handleClick skips starting another. */
export function coverTransitionInFlight(): boolean {
  return active !== null
}

/** Record the transition just started and auto-clear when it settles. */
export function registerCoverTransition(t: ViewTransitionLike): void {
  active = t
  clearWatchdog()
  const clear = (): void => {
    if (active === t) {
      active = null
      clearWatchdog()
    }
  }
  // .finished resolves on completion and rejects if skipped — clear on both.
  void Promise.resolve(t.finished).then(clear, clear)
  // Backstop: if the transition wedges (never settles), kill it so no snapshot
  // is stranded regardless of which navigation path interrupted it.
  watchdog = setTimeout(() => {
    if (active === t) flushCoverTransition()
  }, WATCHDOG_MS)
}

/**
 * Force any in-flight cover morph to its end state immediately so its snapshot
 * is removed before the caller mutates the screen. Safe to call when nothing is
 * running. Called from the nav/close path right before a back/close swap.
 */
export function flushCoverTransition(): void {
  active?.skipTransition?.()
  active = null
  clearWatchdog()
}
