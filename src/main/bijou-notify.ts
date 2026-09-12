import { Notification, shell } from 'electron'
import { getValue, setValue } from './store.js'
import { PUBLIC_BUILD } from '../shared/build-flags.js'

// Bijou grab notifier — closes the loop the right-click extension opens. The
// user tracks an upcoming record from the browser; weeks later bijou's RED
// poller grabs it, and without this nothing ever says so. Polls bijou's
// /red/ JSON (watchlist + ledger) and fires a native notification for ledger
// entries not seen before. Same silent-baseline-then-diff lifecycle as the
// show-announcement notifier (shows-notify.ts).
//
// Bijou is private infra; the whole module is a no-op in the public build
// and when no bijouUrl is configured.

const FIRST_TICK_DELAY_MS = 30_000
const POLL_MS = 5 * 60_000
const FETCH_TIMEOUT_MS = 10_000

interface LedgerEntry {
  torrent_id: number
  group_name: string
  group_year: number | null
  format: string
  encoding: string
}

let kickoff: NodeJS.Timeout | null = null
let timer: NodeJS.Timeout | null = null

function notify(entries: LedgerEntry[], bijouUrl: string): void {
  if (!Notification.isSupported() || entries.length === 0) return
  let title: string
  let body: string
  if (entries.length === 1) {
    const e = entries[0]
    title = `📀 Bijou grabbed: ${e.group_name}`
    const year = e.group_year ? `${e.group_year} · ` : ''
    body = `${year}${e.format}/${e.encoding} — on its way to the library`
  } else {
    title = `📀 Bijou grabbed ${entries.length} records`
    const names = entries.slice(0, 3).map((e) => e.group_name)
    const more = entries.length - names.length
    body = names.join(', ') + (more > 0 ? `, +${more} more` : '')
  }
  const n = new Notification({ title, body })
  n.on('click', () => void shell.openExternal(bijouUrl))
  n.show()
}

async function tick(): Promise<void> {
  const bijouUrl = getValue('bijouUrl').replace(/\/$/, '')
  if (!bijouUrl) return
  let ledger: LedgerEntry[]
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
    try {
      const r = await fetch(`${bijouUrl}/red/`, { signal: ac.signal })
      if (!r.ok) return
      const data = (await r.json()) as { ledger?: LedgerEntry[] }
      ledger = data.ledger ?? []
    } finally {
      clearTimeout(t)
    }
  } catch {
    return // box asleep / tailnet down — try again next tick
  }

  const ids = ledger.map((e) => e.torrent_id)
  if (!getValue('bijouNotifyBaselineSet')) {
    setValue('bijouNotifiedGrabIds', ids)
    setValue('bijouNotifyBaselineSet', true)
    return
  }
  const seen = new Set(getValue('bijouNotifiedGrabIds'))
  const fresh = ledger.filter((e) => !seen.has(e.torrent_id))
  if (fresh.length === 0) return
  setValue('bijouNotifiedGrabIds', [...new Set([...seen, ...ids])])
  notify(fresh, bijouUrl)
}

export function startBijouGrabNotifier(): void {
  if (PUBLIC_BUILD) return
  kickoff = setTimeout(() => {
    void tick()
    timer = setInterval(() => void tick(), POLL_MS)
  }, FIRST_TICK_DELAY_MS)
}

export function stopBijouGrabNotifier(): void {
  if (kickoff !== null) clearTimeout(kickoff)
  if (timer !== null) clearInterval(timer)
  kickoff = null
  timer = null
}
