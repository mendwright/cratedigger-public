import type { ContinuationMode } from '../../../shared/plex'

type SettingsApi = Window['cratedigger']['settings']

/** The mutable settings payload — the shape `settings.set` accepts. */
export interface SettingsPatch {
  lastfmApiKey?: string
  taggerApiKey?: string
  ticketmasterApiKey?: string
  geniusClientId?: string
  geniusClientSecret?: string
  plexAdminToken?: string
  bijouUrl?: string
  kioskUrl?: string
  continuationMode?: ContinuationMode
  showNotificationsEnabled?: boolean
}

export interface SettingsDeps {
  /** Surface a transient toast (owned by PlexState, shared across flows). */
  flashToast: (kind: 'ok' | 'err', text: string) => void
  /** Settings IPC. Defaults to the live bridge; tests pass a stub. */
  settings?: SettingsApi
}

/**
 * Owns the Settings modal's state: the open flag, the API-key + preference
 * fields, and a load-once latch. The fields are display/edit state only — the
 * keys are persisted in the main-process store and read there, so nothing in
 * the renderer reads them back. Extracted from PlexState as a small, injected
 * module so the load-once + save-merge logic is unit-testable against a stub.
 *
 * `continuationMode` lives here (it's a setting) and is read by
 * PlaybackController through an injected getter.
 */
export class SettingsController {
  open = $state(false)
  loaded = $state(false)
  lastfmApiKey = $state('')
  taggerApiKey = $state('')
  ticketmasterApiKey = $state('')
  geniusClientId = $state('')
  geniusClientSecret = $state('')
  plexAdminToken = $state('')
  bijouUrl = $state('')
  kioskUrl = $state('')
  continuationMode = $state<ContinuationMode>('album-end')
  showNotificationsEnabled = $state(true)

  #api: SettingsApi
  #flashToast: SettingsDeps['flashToast']

  constructor(deps: SettingsDeps) {
    this.#api = deps.settings ?? window.cratedigger.settings
    this.#flashToast = deps.flashToast
  }

  /** Fetch the persisted settings once. No-ops on subsequent opens. */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    try {
      const s = await this.#api.get()
      this.lastfmApiKey = s.lastfmApiKey
      this.taggerApiKey = s.taggerApiKey
      this.ticketmasterApiKey = s.ticketmasterApiKey
      this.geniusClientId = s.geniusClientId
      this.geniusClientSecret = s.geniusClientSecret
      this.plexAdminToken = s.plexAdminToken
      this.bijouUrl = s.bijouUrl
      this.kioskUrl = s.kioskUrl
      this.continuationMode = s.continuationMode
      this.showNotificationsEnabled = s.showNotificationsEnabled
    } catch {
      // keep defaults empty
    } finally {
      this.loaded = true
    }
  }

  close(): void {
    this.open = false
  }

  async save(args: SettingsPatch): Promise<void> {
    try {
      await this.#api.set(args)
      if (typeof args.lastfmApiKey === 'string') this.lastfmApiKey = args.lastfmApiKey
      if (typeof args.taggerApiKey === 'string') this.taggerApiKey = args.taggerApiKey
      if (typeof args.ticketmasterApiKey === 'string') {
        this.ticketmasterApiKey = args.ticketmasterApiKey
      }
      if (typeof args.geniusClientId === 'string') this.geniusClientId = args.geniusClientId
      if (typeof args.geniusClientSecret === 'string') {
        this.geniusClientSecret = args.geniusClientSecret
      }
      if (typeof args.plexAdminToken === 'string') this.plexAdminToken = args.plexAdminToken
      if (typeof args.bijouUrl === 'string') this.bijouUrl = args.bijouUrl
      if (typeof args.kioskUrl === 'string') this.kioskUrl = args.kioskUrl
      if (typeof args.continuationMode === 'string') {
        this.continuationMode = args.continuationMode
      }
      if (typeof args.showNotificationsEnabled === 'boolean') {
        this.showNotificationsEnabled = args.showNotificationsEnabled
      }
      this.#flashToast('ok', 'Settings saved')
    } catch (err) {
      this.#flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }
}
