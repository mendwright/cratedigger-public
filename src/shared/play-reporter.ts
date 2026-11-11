// Tells Plex what an in-app player is playing, the way Plexamp does: a
// timeline post on every state change and every 10s while playing, and a
// 'stopped' when the track is left. PMS turns those posts into a session, and
// when a *playing* post first crosses ~50% of the track it marks it played
// and writes it to /status/sessions/history — which is what Tautulli,
// multi-scrobbler/Last.fm and the year-end charts read. (/:/scrobble only
// bumps the play count; it never writes history, so timeline posts are the
// whole mechanism.)
//
// That crossing has to be a playing post. A
// seek makes the player read "paused" for a few ms; if that blip is the post
// that crosses the line, PMS never counts the track. So a pause is only
// reported once it has held for PAUSE_SETTLE_MS.
//
// The living-room receiver (pi-player/receiver.mjs) does the same thing for
// itself; this is the equivalent for desktop "This Mac" playback. The phone
// app carries a Dart port of this logic (cratedigger_mobile play_reporter.dart).

export type PlayState = 'playing' | 'paused' | 'stopped'

export interface PlaySample {
  ratingKey: string
  state: PlayState
  timeMs: number
  durationMs: number
  playQueueId?: number | null
}

export const REPORT_INTERVAL_MS = 10_000
// A track that ran out reads as "paused at the end" on an <audio> element.
// Within this much of the end, a non-playing sample is a finished track.
const END_SLOP_MS = 1500
// A playing position this far off where the clock says it should be is a seek
// — post it right away instead of waiting for the next tick.
const SEEK_JUMP_MS = 3000
export const PAUSE_SETTLE_MS = 1500

type Schedule = (fn: () => void, ms: number) => { cancel(): void }
const defaultSchedule: Schedule = (fn, ms) => {
  const t = setTimeout(fn, ms)
  return { cancel: () => clearTimeout(t) }
}

export class PlayReporter {
  #post: (s: PlaySample) => Promise<unknown>
  #now: () => number
  #current: PlaySample | null = null
  #lastPostedState: PlayState | null = null
  #lastPostAt = 0
  #lastPostedTimeMs = 0
  #schedule: Schedule
  #pendingPause: { cancel(): void } | null = null

  constructor(
    post: (s: PlaySample) => Promise<unknown>,
    now: () => number = Date.now,
    schedule: Schedule = defaultSchedule
  ) {
    this.#post = post
    this.#now = now
    this.#schedule = schedule
  }

  /** Feed every timeline change (or null when nothing is loaded). */
  observe(next: PlaySample | null): void {
    const cur = this.#current
    if (cur && (!next || next.ratingKey !== cur.ratingKey)) {
      // Left the track (skip, natural advance, queue cleared) — close its
      // session at the last position we saw.
      if (this.#lastPostedState !== 'stopped') this.#send({ ...cur, state: 'stopped' })
      this.#current = null
      this.#lastPostedState = null
    }
    if (!next) return
    const finished =
      next.state !== 'playing' && next.durationMs > 0 && next.timeMs >= next.durationMs - END_SLOP_MS
    const sample: PlaySample = finished ? { ...next, state: 'stopped' } : next
    // A track that's loaded but hasn't started isn't a play yet.
    if (!this.#current && sample.state !== 'playing') return
    this.#current = sample
    if (sample.state === 'paused') {
      if (this.#lastPostedState !== 'paused' && !this.#pendingPause) {
        this.#pendingPause = this.#schedule(() => {
          this.#pendingPause = null
          const cur = this.#current
          if (cur?.state === 'paused') this.#send(cur)
        }, PAUSE_SETTLE_MS)
      }
      return
    }
    const sinceLast = this.#now() - this.#lastPostAt
    const due = sample.state === 'playing' && sinceLast >= REPORT_INTERVAL_MS
    const jumped = sample.state === 'playing' && this.#lastPostedState === 'playing' &&
      Math.abs(sample.timeMs - (this.#lastPostedTimeMs + sinceLast)) > SEEK_JUMP_MS
    if (sample.state !== this.#lastPostedState || due || jumped) this.#send(sample)
  }

  #send(s: PlaySample): void {
    this.#pendingPause?.cancel()
    this.#pendingPause = null
    this.#lastPostedState = s.state
    this.#lastPostAt = this.#now()
    this.#lastPostedTimeMs = s.timeMs
    void this.#post(s).catch(() => {})
  }
}
