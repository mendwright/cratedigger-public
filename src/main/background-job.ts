// Shared mechanics for main-process background jobs (library warmer, release
// radar, label index). Each job is a long loop over library items that the
// renderer can start, watch, and cancel — so they all need the same plumbing:
// a progress object kept up to date and broadcast on every change, an
// idempotent start (a second start while running is a no-op), and a cancel
// flag the loop polls between items.
//
// Plain TS, no Electron imports: the broadcast is injected as a callback
// (each job wires it to webContents.send on its own channel), which keeps the
// runner unit-testable without a BrowserWindow.

export class BackgroundJobRunner<P extends { running: boolean }> {
  private state: P
  private cancelFlag = false
  private active = false

  constructor(
    initial: P,
    private readonly broadcast: (progress: P) => void
  ) {
    this.state = initial
  }

  // Latest progress, exactly as last broadcast. Jobs read counters off this
  // when patching (`done: job.progress.done + 1`).
  get progress(): P {
    return this.state
  }

  // True once stop() has been called on the in-flight run. The job's loop
  // checks this between items and bails out.
  get cancelled(): boolean {
    return this.cancelFlag
  }

  getProgress(): P {
    return this.state
  }

  // Merge a patch into the progress object and broadcast the result.
  update(patch: Partial<P>): void {
    this.state = { ...this.state, ...patch }
    this.broadcast(this.state)
  }

  // Request cancellation of the in-flight run. No-op when nothing is running,
  // so a stale Stop click can't poison the *next* run's cancel flag.
  stop(): void {
    if (this.active) this.cancelFlag = true
  }

  // Run `body` unless a run is already in flight, in which case resolve to
  // undefined without touching progress. `startPatch` is applied (with
  // `running: true`) before the body, `finishPatch` (with `running: false`)
  // after it — including when the body throws, in which case the error still
  // propagates to the caller after the running/cancel state is reset.
  async run<R>(
    startPatch: Partial<P>,
    body: () => Promise<R>,
    finishPatch: Partial<P> = {}
  ): Promise<R | undefined> {
    if (this.active) return undefined
    this.active = true
    this.cancelFlag = false
    this.update({ ...startPatch, running: true } as Partial<P>)
    try {
      return await body()
    } finally {
      this.active = false
      this.cancelFlag = false
      this.update({ ...finishPatch, running: false } as Partial<P>)
    }
  }
}

// Shared breather between loop items — every job paces itself so on-demand UI
// requests can slip into the MusicBrainz queue while a crawl is running.
export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}
