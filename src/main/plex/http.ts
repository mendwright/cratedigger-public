const DEFAULT_TIMEOUT_MS = 15000

// Errors thrown by plexFetch carry a `kind` so callers can tell a transient
// slow/timed-out response apart from a genuinely unreachable host. The timeline
// poll uses this: a slow poll during a track transition must NOT evict the
// cached player connection (that forces an expensive re-probe), whereas an
// unreachable host should.
export type PlexFetchErrorKind = 'timeout' | 'unreachable' | 'http'

export function plexFetchErrorKind(err: unknown): PlexFetchErrorKind | null {
  if (err && typeof err === 'object' && 'plexFetchKind' in err) {
    return (err as { plexFetchKind: PlexFetchErrorKind }).plexFetchKind
  }
  return null
}

function tagged(message: string, kind: PlexFetchErrorKind): Error {
  const err = new Error(message) as Error & { plexFetchKind: PlexFetchErrorKind }
  err.plexFetchKind = kind
  return err
}

// Fetch wrapper for Plex calls that fails fast on an unresponsive server
// instead of hanging forever. A swap-bound PMS can take 100+ seconds on its
// first request after paging in — we'd rather surface a clear error than
// leave the renderer spinning.
export async function plexFetch(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const ctrl = new AbortController()
  const upstream = init.signal
  if (upstream) {
    if (upstream.aborted) ctrl.abort(upstream.reason)
    else upstream.addEventListener('abort', () => ctrl.abort(upstream.reason), { once: true })
  }
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      const host = hostOf(url)
      throw tagged(`Plex server slow to respond (${host}) — try restarting it.`, 'timeout')
    }
    if (ctrl.signal.aborted && ctrl.signal.reason instanceof DOMException && ctrl.signal.reason.name === 'TimeoutError') {
      const host = hostOf(url)
      throw tagged(`Plex server slow to respond (${host}) — try restarting it.`, 'timeout')
    }
    // Node's undici throws `TypeError: fetch failed` with the real reason
    // (ECONNREFUSED, ENOTFOUND, EHOSTUNREACH, etc.) hidden on `.cause`.
    // Bake host + cause code into the message so the renderer toast is useful.
    if (err instanceof Error && /fetch failed/i.test(err.message)) {
      const host = hostOf(url)
      const cause = (err as { cause?: unknown }).cause
      const code =
        cause && typeof cause === 'object' && 'code' in cause
          ? String((cause as { code: unknown }).code)
          : cause instanceof Error
            ? cause.message
            : null
      throw tagged(`Can't reach ${host}${code ? ` (${code})` : ''}`, 'unreachable')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function hostOf(url: string | URL): string {
  try {
    return new URL(typeof url === 'string' ? url : url.href).host
  } catch {
    return String(url)
  }
}
