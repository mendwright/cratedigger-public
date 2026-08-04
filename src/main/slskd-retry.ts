import { BrowserWindow } from 'electron'
import { PUBLIC_BUILD } from '../shared/build-flags.js'
import type { SlskdDownloads } from '../shared/slskd.js'
import { listDownloads, retryDownload } from './slskd.js'
import { getSlskdUrl } from './store.js'

// Auto-retry for failed Soulseek transfers. slskd gives up on a download the
// moment the uploader stalls, disconnects, or its queue times out, and most of
// those failures are transient — the same file usually lands on a second ask.
// Without this the Downloads list slowly fills with dead rows the user has to
// hit ↻ on one by one.
//
// Each file gets three automatic asks, spaced out (see RETRY_DELAYS_MS), then
// stops. Spacing matters more than the count: the most common real failure is an
// uploader who went away, which a burst of asks a minute apart neither fixes nor
// endears us to them — Soulseek users do notice repeat requests. Three widely
// spaced asks cover "they came back after lunch". The manual ↻ button is still
// there for anything that spends its budget.
//
// Attempts are keyed by uploader + filename, NOT slskd's transfer id — a retry
// removes the old entry and re-POSTs, so slskd hands back a brand-new id every
// time and an id-keyed budget would never run out.

// Wait before attempt 1, 2, 3 — measured from the previous attempt, or from the
// moment we first saw the failure for attempt 1. The first ask is effectively
// immediate (next sweep tick).
const RETRY_DELAYS_MS = [0, 10 * 60_000, 45 * 60_000]
export const MAX_AUTO_RETRIES = RETRY_DELAYS_MS.length

const FIRST_TICK_DELAY_MS = 20_000
const POLL_MS = 60_000
const RETRY_GAP_MS = 750
// Bound the attempts map so a very long-lived session with a lot of churn can't
// grow it without limit. Clearing it just hands everyone a fresh budget.
const ATTEMPTS_CAP = 5000

/**
 * Which slskd transfer states are worth another ask. Pure; exported for tests.
 *
 * `Cancelled` is the user (or our own post-import sweep) pressing stop —
 * re-POSTing it would fight them. `Rejected` is the peer saying the file isn't
 * shared anymore, which no retry can fix. That leaves `Errored` and `TimedOut`:
 * connection reset, uploader went offline mid-queue, remote queue expired.
 */
export function isRetryableFailure(state: string): boolean {
  const low = state.toLowerCase()
  if (low.includes('cancelled') || low.includes('rejected')) return false
  return low.includes('errored') || low.includes('timedout')
}

/** How many automatic asks a file has had, and the earliest time for the next. */
interface AttemptRecord {
  attempts: number
  dueAt: number
}

const attempts = new Map<string, AttemptRecord>()

function attemptKey(username: string, filename: string): string {
  return `${username}\0${filename}`
}

export interface RetrySweepDeps {
  list?: () => Promise<SlskdDownloads>
  retry?: (username: string, id: string, filename: string, size: number) => Promise<void>
  /** Pause between retries so a folder-wide failure doesn't burst at slskd. */
  gapMs?: number
  /** Injectable clock so the backoff is testable without waiting it out. */
  now?: () => number
}

export interface RetrySweepResult {
  /** Files re-POSTed on this pass. */
  retried: number
  /** Failures still inside their backoff window — they get another ask later. */
  waiting: number
  /** Failures left alone for good, having spent all their automatic asks. */
  exhausted: number
  /** Retries slskd refused. The attempt is spent; the backoff carries on. */
  errors: number
}

/**
 * One pass: list transfers, re-POST every retryable failure whose backoff has
 * elapsed. Exported (and dependency-injectable) so the logic is testable without
 * a live slskd or a real clock.
 *
 * The attempt is recorded *before* the retry is awaited. That's deliberate — a
 * retry that itself throws spends the attempt and waits out the next backoff
 * rather than looping, and it also means an overlapping pass can't double-fire
 * the same file.
 */
export async function sweepFailedDownloads(deps: RetrySweepDeps = {}): Promise<RetrySweepResult> {
  const list = deps.list ?? listDownloads
  const retry = deps.retry ?? retryDownload
  const gapMs = deps.gapMs ?? RETRY_GAP_MS
  const now = (deps.now ?? Date.now)()
  const result: RetrySweepResult = { retried: 0, waiting: 0, exhausted: 0, errors: 0 }

  const downloads = await list()
  const candidates: { username: string; id: string; filename: string; size: number }[] = []
  for (const user of downloads.users) {
    for (const dir of user.directories) {
      for (const file of dir.files) {
        const key = attemptKey(user.username, file.filename)
        // A file that made it through is done with us: drop its record so a
        // later re-grab of the same name starts on a full budget. Only
        // "Succeeded" counts — a file we just retried reads as Queued for a
        // while, and forgetting *those* would hand out retries forever.
        if (file.state.toLowerCase().includes('succeeded')) {
          attempts.delete(key)
          continue
        }
        if (!isRetryableFailure(file.state)) continue
        const record = attempts.get(key) ?? { attempts: 0, dueAt: now + RETRY_DELAYS_MS[0] }
        attempts.set(key, record)
        if (record.attempts >= MAX_AUTO_RETRIES) {
          result.exhausted += 1
          continue
        }
        if (now < record.dueAt) {
          result.waiting += 1
          continue
        }
        record.attempts += 1
        record.dueAt = now + (RETRY_DELAYS_MS[record.attempts] ?? 0)
        candidates.push({
          username: user.username,
          id: file.id,
          filename: file.filename,
          size: file.size
        })
      }
    }
  }
  if (attempts.size > ATTEMPTS_CAP) attempts.clear()

  for (const [i, c] of candidates.entries()) {
    try {
      await retry(c.username, c.id, c.filename, c.size)
      result.retried += 1
    } catch {
      // slskd unreachable or the entry vanished under us — the next backoff
      // window will pick it up again if it has asks left.
      result.errors += 1
    }
    if (i + 1 < candidates.length && gapMs > 0) {
      await new Promise((r) => setTimeout(r, gapMs))
    }
  }
  return result
}

let kickoff: NodeJS.Timeout | null = null
let timer: NodeJS.Timeout | null = null
let sweeping = false

function announce(count: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('slskd:auto-retried', { count })
  }
}

async function tick(): Promise<void> {
  if (sweeping || !getSlskdUrl()) return
  sweeping = true
  try {
    const { retried } = await sweepFailedDownloads()
    if (retried > 0) announce(retried)
  } catch {
    // slskd asleep / wedged — try again next tick.
  } finally {
    sweeping = false
  }
}

/**
 * Start the background sweeper. Runs while the app is open regardless of which
 * screen is showing, so a batch of grabs left downloading heals itself even
 * after the user navigates away from Soulseek.
 */
export function startSlskdRetrySweeper(): void {
  if (PUBLIC_BUILD || kickoff !== null || timer !== null) return
  kickoff = setTimeout(() => {
    void tick()
    timer = setInterval(() => void tick(), POLL_MS)
  }, FIRST_TICK_DELAY_MS)
}

export function stopSlskdRetrySweeper(): void {
  if (kickoff !== null) clearTimeout(kickoff)
  if (timer !== null) clearInterval(timer)
  kickoff = null
  timer = null
}

export function _resetAutoRetryStateForTests(): void {
  attempts.clear()
  sweeping = false
}
