import { BrowserWindow, Notification } from 'electron'
import type { ReportedShowMatch, ShowMatchReport } from '../shared/plex.js'
import {
  addNotifiedShowIds,
  addRecentlyNotifiedShowIds,
  getValue,
  setValue
} from './store.js'

// Sort newest-announced-feel first isn't possible (we don't track announce
// time), so order the alert by soonest show date — that's the one the user is
// most likely to want to grab tickets for.
function byDate(a: ReportedShowMatch, b: ReportedShowMatch): number {
  return a.date.localeCompare(b.date)
}

function focusToShows(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send('shows:open-from-notification')
}

function notify(newMatches: ReportedShowMatch[]): void {
  if (!Notification.isSupported() || newMatches.length === 0) return
  const sorted = [...newMatches].sort(byDate)
  let title: string
  let body: string
  if (sorted.length === 1) {
    const m = sorted[0]
    title = `🎵 ${m.artistName} just announced a show`
    body = `${m.date} · ${m.venueName}`
  } else {
    const names = sorted.slice(0, 3).map((m) => m.artistName)
    const more = sorted.length - names.length
    title = `🎵 ${sorted.length} library artists announced shows`
    body = names.join(', ') + (more > 0 ? `, +${more} more` : '') + ' — at your venues'
  }
  const n = new Notification({ title, body })
  n.on('click', focusToShows)
  n.show()
}

/**
 * Diff the renderer's current library-matched shows against the persisted
 * notified-set and fire a native notification for any newly-announced ones.
 *
 * First call ever (baseline not set) seeds the notified-set silently so the user
 * isn't pinged for every already-listed show at once. After that, only ids not
 * previously seen produce a notification, and every reported id is recorded so a
 * show pings at most once.
 *
 * Returns the newly-announced subset so the renderer can also surface an in-app
 * banner. The renderer is responsible for not calling this when the master
 * toggle is off; we re-check here as a backstop (and still seed the baseline so
 * flipping the toggle on later doesn't dump the backlog).
 */
export function reportShowMatches(matches: ReportedShowMatch[]): ShowMatchReport {
  const ids = matches.map((m) => m.id)

  if (!getValue('showsNotifyBaselineSet')) {
    addNotifiedShowIds(ids)
    setValue('showsNotifyBaselineSet', true)
    return { newMatches: [] }
  }

  const seen = new Set(getValue('notifiedShowIds'))
  const newMatches = matches.filter((m) => !seen.has(m.id))
  // Record everything reported (not just the new), so a match that drops off a
  // venue page and reappears later doesn't re-notify.
  addNotifiedShowIds(ids)
  // Also stamp the new ones as "recently announced" — the Shows screen badges
  // these rows so a notification click lands on something findable.
  addRecentlyNotifiedShowIds(newMatches.map((m) => m.id))

  if (newMatches.length > 0 && getValue('showNotificationsEnabled')) {
    notify(newMatches)
  }
  return { newMatches }
}
