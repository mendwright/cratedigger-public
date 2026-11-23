// "Scan Plex library" in the top bar: asks Plex to rescan the active music
// section, waits for the scan to finish, then reloads the crate so new albums
// show up. Plex only lets the server owner scan, so `canScan` stays false for
// other accounts (e.g. the shop Mac) and the button never renders there.

export type ScanPhase = 'idle' | 'scanning' | 'done' | 'error'

export interface LibraryScanDeps {
  serverId: () => string | null
  sectionKey: () => string | null
  /** Reload the album grid + full-library cache after the scan lands. */
  reloadLibrary: () => Promise<void>
  flashToast: (kind: 'ok' | 'err', text: string) => void
  api?: {
    isServerOwner: (serverId: string) => Promise<boolean>
    scanLibrary: (args: { serverId: string; sectionKey: string }) => Promise<void>
    isLibraryScanning: (args: { serverId: string; sectionKey: string }) => Promise<boolean>
  }
  pollMs?: number
  /** Give up waiting after this long; the scan keeps going on the server. */
  maxWaitMs?: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class LibraryScanController {
  canScan = $state(false)
  phase = $state<ScanPhase>('idle')
  private ownerCheckedFor: string | null = null
  private resetTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private deps: LibraryScanDeps) {}

  private get api(): NonNullable<LibraryScanDeps['api']> {
    return this.deps.api ?? window.cratedigger.plex
  }

  /** Look up ownership once per server. Cheap to call from an $effect. */
  async checkOwner(): Promise<void> {
    const serverId = this.deps.serverId()
    if (!serverId) {
      this.canScan = false
      this.ownerCheckedFor = null
      return
    }
    if (this.ownerCheckedFor === serverId) return
    this.ownerCheckedFor = serverId
    try {
      const owner = await this.api.isServerOwner(serverId)
      if (this.deps.serverId() === serverId) this.canScan = owner
    } catch {
      if (this.deps.serverId() === serverId) {
        this.canScan = false
        this.ownerCheckedFor = null
      }
    }
  }

  async scan(): Promise<void> {
    if (this.phase === 'scanning') return
    const serverId = this.deps.serverId()
    const sectionKey = this.deps.sectionKey()
    if (!serverId || !sectionKey) return
    if (this.resetTimer) clearTimeout(this.resetTimer)
    this.phase = 'scanning'
    const pollMs = this.deps.pollMs ?? 2500
    const maxWaitMs = this.deps.maxWaitMs ?? 10 * 60_000
    try {
      await this.api.scanLibrary({ serverId, sectionKey })
      // Plex can take a moment to flag the section as refreshing, so wait one
      // beat before the first check or a fast poll reads "not scanning" early.
      const started = Date.now()
      let finished = false
      while (Date.now() - started < maxWaitMs) {
        await sleep(pollMs)
        if (!(await this.api.isLibraryScanning({ serverId, sectionKey }))) {
          finished = true
          break
        }
      }
      await this.deps.reloadLibrary()
      this.phase = 'done'
      this.deps.flashToast(
        'ok',
        finished ? 'Library scan finished' : 'Scan still running on Plex — reloaded what’s there'
      )
    } catch (err) {
      this.phase = 'error'
      this.deps.flashToast('err', err instanceof Error ? err.message : String(err))
    } finally {
      this.resetTimer = setTimeout(() => {
        if (this.phase !== 'scanning') this.phase = 'idle'
      }, 4000)
    }
  }

  dispose(): void {
    if (this.resetTimer) clearTimeout(this.resetTimer)
    this.resetTimer = null
  }
}
