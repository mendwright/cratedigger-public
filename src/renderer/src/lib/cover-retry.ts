// Self-healing cover art. A Wi-Fi roam or sleep/wake blip can fail a burst of
// cratedigger-plex:// image loads at once, and a broken <img> never re-requests
// its src — so one transient outage used to blank the whole grid for the rest
// of the session. The main-process proxy already absorbs short blips with fast
// retries (transcode-fetch.ts); this layer handles the longer ones: listen for
// load errors on any cover image, document-wide, and re-request with a paced
// backoff and a cache-busting param so Chromium actually refetches.
//
// One capture-phase listener instead of per-component onerror handlers: 'error'
// doesn't bubble, but it does propagate down the capture path, so a single
// document listener sees every <img> failure in the app — including components
// added later that never think about retry.

export const COVER_RETRY_DELAYS_MS = [2000, 10000, 30000]
const RETRY_PARAM = 'retry'

// Identity of a cover regardless of retry attempt: the src with the
// cache-busting param stripped. Null for anything that isn't a proxied cover
// (external images, data URIs, empty src).
export function coverKey(src: string): string | null {
  if (!src.startsWith('cratedigger-plex://')) return null
  const url = new URL(src)
  url.searchParams.delete(RETRY_PARAM)
  return url.toString()
}

export function retrySrc(key: string, attempt: number): string {
  const url = new URL(key)
  url.searchParams.set(RETRY_PARAM, String(attempt))
  return url.toString()
}

const attempts = new WeakMap<HTMLImageElement, number>()

function scheduleRetry(img: HTMLImageElement): void {
  const failedKey = coverKey(img.src)
  if (!failedKey) return
  const attempt = attempts.get(img) ?? 0
  if (attempt >= COVER_RETRY_DELAYS_MS.length) return
  attempts.set(img, attempt + 1)
  setTimeout(() => {
    // The element may be gone (grid re-render) or recycled onto a different
    // album (src swapped by reactivity) by the time the timer fires — in
    // either case this retry is stale, and the new src runs its own lifecycle.
    if (!img.isConnected || coverKey(img.src) !== failedKey) return
    img.src = retrySrc(failedKey, attempt + 1)
  }, COVER_RETRY_DELAYS_MS[attempt])
}

export function installCoverRetry(): void {
  document.addEventListener(
    'error',
    (e) => {
      if (e.target instanceof HTMLImageElement) scheduleRetry(e.target)
    },
    true
  )
  // A successful load clears the counter, so a later blip on the same element
  // gets a fresh retry budget.
  document.addEventListener(
    'load',
    (e) => {
      if (e.target instanceof HTMLImageElement) attempts.delete(e.target)
    },
    true
  )
}
