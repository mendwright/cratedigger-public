import { shell } from 'electron'
import type { PlexPin, PlexUser, AuthProgress } from '../../shared/plex.js'
import { plexHeaders, PLEX_PRODUCT } from './headers.js'
import { getClientIdentifier } from '../store.js'

const PLEX_API = 'https://plex.tv/api/v2'
const POLL_INTERVAL_MS = 2000

export type ProgressCallback = (p: AuthProgress) => void

export class AuthFlow {
  private cancelled = false

  cancel(): void {
    this.cancelled = true
  }

  async run(onProgress: ProgressCallback): Promise<{ token: string; user: PlexUser }> {
    onProgress({ stage: 'creating-pin' })

    const pin = await createPin()
    const claimUrl = buildClaimUrl(pin.code)

    onProgress({
      stage: 'awaiting-claim',
      code: pin.code,
      claimUrl,
      expiresAt: pin.expiresAt
    })

    await shell.openExternal(claimUrl)

    const token = await this.pollForToken(pin)
    const user = await fetchUser(token)
    onProgress({ stage: 'signed-in', user })
    return { token, user }
  }

  private async pollForToken(pin: PlexPin): Promise<string> {
    const deadline = new Date(pin.expiresAt).getTime()
    while (!this.cancelled) {
      if (Date.now() > deadline) throw new Error('PIN expired before it was claimed')
      await sleep(POLL_INTERVAL_MS)
      if (this.cancelled) throw new Error('Sign-in cancelled')
      const status = await fetchPin(pin.id)
      if (status.authToken) return status.authToken
    }
    throw new Error('Sign-in cancelled')
  }
}

async function createPin(): Promise<PlexPin> {
  const body = new URLSearchParams({ strong: 'true' })
  const res = await fetch(`${PLEX_API}/pins`, {
    method: 'POST',
    headers: plexHeaders(),
    body
  })
  if (!res.ok) throw new Error(`Plex pin create failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as PlexPin
}

async function fetchPin(id: number): Promise<PlexPin> {
  const res = await fetch(`${PLEX_API}/pins/${id}`, { headers: plexHeaders() })
  if (!res.ok) throw new Error(`Plex pin poll failed: ${res.status}`)
  return (await res.json()) as PlexPin
}

export type FetchUserResult =
  | { ok: true; user: PlexUser }
  | { ok: false; authFailed: true; status: number }
  | { ok: false; authFailed: false; reason: string }

export async function fetchUser(token: string): Promise<PlexUser> {
  const res = await verifyUser(token)
  if (res.ok) return res.user
  if (res.authFailed) throw new Error(`Plex user fetch failed: ${res.status}`)
  throw new Error(res.reason)
}

// Non-throwing variant for session-bootstrap paths that must distinguish a
// bad token (401/403 — wipe it) from a transient network/gateway problem
// (5xx, DNS, offline — keep the token so we can try again later).
export async function verifyUser(token: string): Promise<FetchUserResult> {
  try {
    const res = await fetch(`${PLEX_API}/user`, { headers: plexHeaders(token) })
    if (res.ok) return { ok: true, user: (await res.json()) as PlexUser }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, authFailed: true, status: res.status }
    }
    return { ok: false, authFailed: false, reason: `Plex user fetch: ${res.status}` }
  } catch (err) {
    return { ok: false, authFailed: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

function buildClaimUrl(code: string): string {
  const params = new URLSearchParams({
    clientID: getClientIdentifier(),
    code,
    'context[device][product]': PLEX_PRODUCT
  })
  return `https://app.plex.tv/auth#?${params.toString()}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
