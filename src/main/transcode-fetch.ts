// Fetch Plex image transcodes through Node's network stack (global fetch /
// undici) rather than Electron's `net.fetch`. On a multihomed machine — notably
// one running Tailscale with accept-routes on, which installs a competing
// default route — Chromium's network service intermittently binds the wrong
// source interface for LAN destinations, so a large fraction of the cover-load
// burst dies with net::ERR_ADDRESS_UNREACHABLE. Nothing re-requests a broken
// <img> without the renderer's cover-retry layer, so those covers used to stay
// blank for the whole session. Node's stack honors the OS routing table and
// reaches the LAN Plex host reliably (verified: 26 concurrent transcodes that
// all failed under net.fetch returned 200 here).
// plex.direct serves a publicly-valid wildcard cert, so default TLS validation
// is fine — no agent tweaks needed.

let fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args)

export function _setFetchForTests(f: typeof fetch): void {
  fetchImpl = f
}

async function fetchTranscode(url: string, token: string): Promise<Response> {
  const ctrl = new AbortController()
  // 30s gives Plex's transcoder room to catch up when the library grid dumps
  // dozens of size-changed thumb requests on it at once.
  const timer = setTimeout(() => ctrl.abort(), 30000)
  try {
    return await fetchImpl(url, {
      headers: { 'X-Plex-Token': token, Accept: 'image/*' },
      signal: ctrl.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

// A Wi-Fi roam or sleep/wake blip can kill a whole burst of cover fetches at
// once. Absorb short outages here: network errors fail fast (ERR_UNREACHABLE
// etc.), so a couple of paced retries are cheap and usually land after the
// interface settles. 5xx from Plex (transcoder still waking up) gets the same
// treatment; 4xx does not — that's a real answer, retrying won't change it.
export const TRANSCODE_RETRY_DELAYS_MS = [1000, 3000]

export async function fetchTranscodeWithRetry(url: string, token: string): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt <= TRANSCODE_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, TRANSCODE_RETRY_DELAYS_MS[attempt - 1]))
    }
    try {
      const res = await fetchTranscode(url, token)
      if (res.ok || res.status < 500) return res
      lastError = new Error(`upstream ${res.status}`)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}
