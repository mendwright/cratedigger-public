import { getValue } from './store.js'

// A now-playing kiosk on another machine — a Pi driving a wall display, say —
// isn't Cratedigger, but it can wear Cratedigger's theme. When the user switches
// themes we POST the resolved palette to the kiosk, which stores it and serves
// it back to its own page on the next poll.
//
// Only the palette crosses: the 33 token names from renderer/lib/themes.ts,
// plus an id and a light/dark hint. Cratedigger's per-theme structural CSS
// stays in Cratedigger — the kiosk has its own layout and only needs colours.
//
// Push rather than let the kiosk read from us: this Mac sleeps, and the box
// doesn't. Whatever we sent last stays on screen without us.

export interface KioskTheme {
  id: string
  name: string
  scheme: 'light' | 'dark'
  tokens: Record<string, string>
}

const TIMEOUT_MS = 4000

export async function pushKioskTheme(theme: KioskTheme): Promise<{ ok: boolean }> {
  const base = getValue('kioskUrl').trim().replace(/\/$/, '')
  // No kiosk configured is the normal case for everyone but this house.
  if (!base) return { ok: false }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${base}/api/theme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(theme),
      signal: ac.signal
    })
    return { ok: res.ok }
  } catch {
    // A kiosk that's off, unreachable or mid-restart must never be able to
    // break switching themes in the app itself.
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}
