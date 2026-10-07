import type { PhoneDownloadRequest } from '../../../shared/plex'

// The preload bridge exposes every channel (plex:* and mb:*) under one object.
type PlexApi = Window['cratedigger']['plex']

export interface PhoneDownloadsDeps {
  /** Toast helper — lives on PlexState (shared across controllers), injected here. */
  flashToast: (kind: 'ok' | 'err', text: string) => void
  /** IPC bridge. Defaults to the live bridge; tests stub. */
  plex?: PlexApi
}

/**
 * "Send to phone": albums and playlists the Mac asks the phone app to
 * download. The requests ride the roaming `phone-downloads` doc through the
 * tagger; the phone polls it, downloads what's new, and deletes what's taken
 * back here. The phone only listens once "Get albums sent from the Mac" is on
 * in its settings, and nothing moves while the tagger URL is unset (or in the
 * public build, where roaming sync is off).
 */
export class PhoneDownloadsController {
  requests = $state<PhoneDownloadRequest[]>([])

  #deps: PhoneDownloadsDeps
  #plex: PlexApi

  constructor(deps: PhoneDownloadsDeps) {
    this.#deps = deps
    this.#plex = deps.plex ?? window.cratedigger.plex
  }

  async load(): Promise<void> {
    try {
      this.requests = await this.#plex.listPhoneDownloads()
    } catch {
      // empty list is the default
    }
  }

  isSent(kind: PhoneDownloadRequest['kind'], ratingKey: string): boolean {
    return this.requests.some((r) => r.kind === kind && r.ratingKey === ratingKey)
  }

  async toggle(item: Omit<PhoneDownloadRequest, 'requestedAt'>): Promise<void> {
    try {
      if (this.isSent(item.kind, item.ratingKey)) {
        this.requests = await this.#plex.removePhoneDownload({
          kind: item.kind,
          ratingKey: item.ratingKey
        })
        this.#deps.flashToast('ok', 'Removing from your phone')
      } else {
        this.requests = await this.#plex.addPhoneDownload({
          request: { ...item, requestedAt: Date.now() }
        })
        this.#deps.flashToast('ok', `Sending ${item.title} to your phone`)
      }
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  /** Context-menu entry for an album or playlist. */
  menuItem(item: Omit<PhoneDownloadRequest, 'requestedAt'>): { label: string; onClick: () => void } {
    return {
      label: this.isSent(item.kind, item.ratingKey) ? 'Remove from phone' : 'Send to phone',
      onClick: () => void this.toggle(item)
    }
  }
}
