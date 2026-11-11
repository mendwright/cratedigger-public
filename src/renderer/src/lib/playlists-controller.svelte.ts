import type { MirrorStatus, PlaylistItem, PlexPlaylist, SmartPlaylistDef } from '../../../shared/plex'
import type { Session } from './plex-state.svelte'

type PlexApi = Window['cratedigger']['plex']

export interface PlaylistsDeps {
  session: () => Session | null
  flashToast: (kind: 'ok' | 'err', text: string) => void
  /** Plex IPC. Defaults to the live bridge; tests pass a stub. */
  plex?: PlexApi
}

/**
 * Playlists: the user's Plex audio playlists (source of truth on the server,
 * so Plexamp and the shop Mac see the same lists) plus Cratedigger's local
 * smart-playlist definitions (rules in electron-store, materialized into
 * plain Plex playlists — see chunk on sync in plex/playlists.ts).
 * Components read plexState.playlistsCtl.*.
 */
export class PlaylistsController {
  playlists = $state<PlexPlaylist[]>([])
  loading = $state(false)
  error = $state<string | null>(null)

  // Detail pane — which playlist is open and its items.
  openRatingKey = $state<string | null>(null)
  items = $state<PlaylistItem[]>([])
  itemsLoading = $state(false)
  itemsError = $state<string | null>(null)

  // Smart definitions (rules). UI lives on the Playlists screen; sync is
  // orchestrated by syncSmartDef.
  smartDefs = $state<SmartPlaylistDef[]>([])
  syncingDefId = $state<string | null>(null)

  // Playlist mirroring to a second Plex account (the shop). Status is
  // loaded on activate; `mirror.mirrored` maps source rk → twin rk and
  // presence = mirrored. Mutations re-mirror in the background.
  mirror = $state<MirrorStatus>({ connected: false, account: null, mirrored: {} })
  mirrorBusy = $state<string | null>(null) // rk being synced, or 'auth'

  #deps: PlaylistsDeps
  private plex: PlexApi

  constructor(deps: PlaylistsDeps) {
    this.#deps = deps
    this.plex = deps.plex ?? window.cratedigger.plex
  }

  private get serverId(): string | null {
    const s = this.#deps.session()
    return s?.signedIn ? (s.preferredServerId ?? null) : null
  }

  get open(): PlexPlaylist | null {
    return this.playlists.find((p) => p.ratingKey === this.openRatingKey) ?? null
  }

  /** The smart definition materialized as the given Plex playlist, if any. */
  smartDefFor(plexRatingKey: string): SmartPlaylistDef | null {
    return this.smartDefs.find((d) => d.plexRatingKey === plexRatingKey) ?? null
  }

  async activate(): Promise<void> {
    await Promise.all([this.refresh(), this.loadSmartDefs(), this.loadMirrorStatus()])
  }

  // --- playlist mirroring (second Plex account, e.g. the shop) ---

  async loadMirrorStatus(): Promise<void> {
    try {
      this.mirror = await this.plex.mirrorStatus()
    } catch {
      // non-fatal — mirroring UI just renders disconnected
    }
  }

  isMirrored(ratingKey: string): boolean {
    return ratingKey in this.mirror.mirrored
  }

  /** PIN-flow sign-in as the account to mirror to (opens the browser). */
  async connectMirror(): Promise<void> {
    if (this.mirrorBusy) return
    this.mirrorBusy = 'auth'
    try {
      const res = await this.plex.mirrorStartAuth()
      if (res.ok) {
        await this.loadMirrorStatus()
        this.#deps.flashToast('ok', `Mirroring connected as ${res.account ?? 'the second account'}`)
      } else {
        this.#deps.flashToast('err', res.message)
      }
    } finally {
      this.mirrorBusy = null
    }
  }

  cancelMirrorAuth(): void {
    void this.plex.mirrorCancelAuth()
    this.mirrorBusy = null
  }

  async disconnectMirror(): Promise<void> {
    await this.plex.mirrorDisconnect()
    await this.loadMirrorStatus()
  }

  /** Toggle a playlist's mirror: sync it over, or delete the twin. */
  async toggleMirror(ratingKey: string): Promise<void> {
    const sid = this.serverId
    if (!sid || this.mirrorBusy) return
    const pl = this.playlists.find((p) => p.ratingKey === ratingKey)
    if (!pl) return
    this.mirrorBusy = ratingKey
    try {
      if (this.isMirrored(ratingKey)) {
        await this.plex.mirrorUnsync({ serverId: sid, ratingKey })
        this.#deps.flashToast('ok', `“${pl.title}” no longer mirrored`)
      } else {
        const { itemCount } = await this.plex.mirrorSync({ serverId: sid, ratingKey, title: pl.title })
        this.#deps.flashToast(
          'ok',
          `“${pl.title}” mirrored to ${this.mirror.account ?? 'the second account'} (${itemCount} tracks)`
        )
      }
      await this.loadMirrorStatus()
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    } finally {
      this.mirrorBusy = null
    }
  }

  async syncAllBothWays(): Promise<void> {
    const sid = this.serverId
    if (!sid || this.mirrorBusy) return
    this.mirrorBusy = 'all'
    try {
      const result = await this.plex.mirrorSyncAll({ serverId: sid })
      await Promise.all([this.refresh(), this.loadMirrorStatus()])
      this.#deps.flashToast(
        'ok',
        `Merged ${result.playlistCount} playlists both ways (${result.createdOnPrimary} added here, ${result.createdOnMirror} added on ${this.mirror.account ?? 'the second account'})`
      )
    } catch (err) {
      this.#deps.flashToast('err', `Two-way sync failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.mirrorBusy = null
    }
  }

  /**
   * Fire-and-forget re-sync after a Cratedigger-driven mutation of a
   * mirrored playlist (add/remove/reorder/rename/smart-sync/import refill).
   * Errors surface as a toast but never block the primary edit.
   */
  remirrorIfMirrored(ratingKey: string): void {
    const sid = this.serverId
    if (!sid || !this.mirror.connected || !this.isMirrored(ratingKey)) return
    const pl = this.playlists.find((p) => p.ratingKey === ratingKey)
    if (!pl) return
    void this.plex
      .mirrorSync({ serverId: sid, ratingKey, title: pl.title })
      .catch((err: unknown) => {
        this.#deps.flashToast(
          'err',
          `Mirror sync failed: ${err instanceof Error ? err.message : String(err)}`
        )
      })
  }

  async refresh(): Promise<void> {
    const sid = this.serverId
    if (!sid) return
    this.loading = true
    this.error = null
    try {
      const raw = await this.plex.listPlaylists({ serverId: sid })
      // Plex keeps one copy of each built-in smart playlist ("All Music",
      // "Recently Added", …) per music section, so a two-section server
      // returns indistinguishable twins. Keep the first of each — they
      // render and play identically.
      const seen = new Set<string>()
      this.playlists = raw.filter((p) => {
        if (!p.smart) return true
        const key = `${p.title}${p.leafCount}${p.durationMs ?? ''}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.loading = false
    }
  }

  async loadSmartDefs(): Promise<void> {
    try {
      this.smartDefs = await this.plex.getSmartPlaylistDefs()
    } catch {
      // non-fatal — smart section just renders empty
    }
  }

  private async persistSmartDefs(): Promise<void> {
    await this.plex.setSmartPlaylistDefs(
      // $state proxies aren't structured-cloneable; snapshot before IPC.
      this.smartDefs.map((d) => ({ ...d, rules: { ...d.rules, genres: [...d.rules.genres], labels: [...d.rules.labels] } }))
    )
  }

  async upsertSmartDef(def: SmartPlaylistDef): Promise<void> {
    const i = this.smartDefs.findIndex((d) => d.id === def.id)
    this.smartDefs = i >= 0
      ? this.smartDefs.map((d) => (d.id === def.id ? def : d))
      : [...this.smartDefs, def]
    await this.persistSmartDefs()
  }

  /** Drop the definition; optionally delete its materialized Plex playlist. */
  async removeSmartDef(id: string, deletePlexPlaylist: boolean): Promise<void> {
    const def = this.smartDefs.find((d) => d.id === id)
    this.smartDefs = this.smartDefs.filter((d) => d.id !== id)
    await this.persistSmartDefs()
    if (deletePlexPlaylist && def?.plexRatingKey) {
      await this.remove(def.plexRatingKey)
    }
  }

  /**
   * Materialize a smart definition into its Plex playlist. The caller
   * (screen) computes the matching album keys — rules read renderer-owned
   * data (label index, effective years) this controller doesn't hold.
   */
  async syncSmartDef(def: SmartPlaylistDef, albumRatingKeys: string[]): Promise<void> {
    const sid = this.serverId
    if (!sid) return
    // One sync at a time. Two concurrent syncs of a def whose playlist isn't
    // materialized yet (plexRatingKey null) would BOTH take the create path
    // and leave an orphaned twin on the server — the screen's stale-def
    // auto-sync racing an explicit "save + fill" does exactly that.
    if (this.syncingDefId !== null) return
    this.syncingDefId = def.id
    try {
      const { plexRatingKey } = await this.plex.syncSmartPlaylist({
        serverId: sid,
        plexRatingKey: def.plexRatingKey,
        title: def.name,
        albumRatingKeys
      })
      await this.upsertSmartDef({ ...def, plexRatingKey, lastSyncedAt: Date.now() })
      await this.refresh()
      if (this.openRatingKey === plexRatingKey) await this.openDetail(plexRatingKey)
      this.remirrorIfMirrored(plexRatingKey)
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    } finally {
      this.syncingDefId = null
    }
  }

  async openDetail(ratingKey: string): Promise<void> {
    this.openRatingKey = ratingKey
    const sid = this.serverId
    if (!sid) return
    this.itemsLoading = true
    this.itemsError = null
    try {
      const items = await this.plex.getPlaylistItems({ serverId: sid, ratingKey })
      // Guard against a stale response after the user clicked another list.
      if (this.openRatingKey === ratingKey) this.items = items
    } catch (err) {
      if (this.openRatingKey === ratingKey) {
        this.itemsError = err instanceof Error ? err.message : String(err)
      }
    } finally {
      if (this.openRatingKey === ratingKey) this.itemsLoading = false
    }
  }

  closeDetail(): void {
    this.openRatingKey = null
    this.items = []
    this.itemsError = null
  }

  async create(title: string, itemRatingKeys: string[]): Promise<PlexPlaylist | null> {
    const sid = this.serverId
    if (!sid) return null
    try {
      const created = await this.plex.createPlaylist({ serverId: sid, title, itemRatingKeys })
      await this.refresh()
      this.#deps.flashToast('ok', `Created “${title}”`)
      return created
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
      return null
    }
  }

  async remove(ratingKey: string): Promise<void> {
    const sid = this.serverId
    if (!sid) return
    try {
      await this.plex.deletePlaylist({ serverId: sid, ratingKey })
      if (this.openRatingKey === ratingKey) this.closeDetail()
      this.playlists = this.playlists.filter((p) => p.ratingKey !== ratingKey)
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  async rename(ratingKey: string, title: string): Promise<void> {
    const sid = this.serverId
    if (!sid || !title.trim()) return
    try {
      await this.plex.renamePlaylist({ serverId: sid, ratingKey, title: title.trim() })
      this.playlists = this.playlists.map((p) =>
        p.ratingKey === ratingKey ? { ...p, title: title.trim() } : p
      )
      // Keep a linked smart definition's name in step.
      const def = this.smartDefFor(ratingKey)
      if (def) await this.upsertSmartDef({ ...def, name: title.trim() })
      this.remirrorIfMirrored(ratingKey)
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  /** Add tracks or whole albums (Plex expands album ids into their tracks). */
  async addItems(ratingKey: string, itemRatingKeys: string[], label?: string): Promise<void> {
    const sid = this.serverId
    if (!sid) return
    try {
      await this.plex.playlistAdd({ serverId: sid, ratingKey, itemRatingKeys })
      const title = this.playlists.find((p) => p.ratingKey === ratingKey)?.title ?? 'playlist'
      this.#deps.flashToast('ok', `Added ${label ?? 'to'} “${title}”`)
      if (this.openRatingKey === ratingKey) await this.openDetail(ratingKey)
      else void this.refresh()
      this.remirrorIfMirrored(ratingKey)
    } catch (err) {
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  async removeItem(ratingKey: string, playlistItemID: number): Promise<void> {
    const sid = this.serverId
    if (!sid) return
    const prev = this.items
    // Optimistic — the row disappears immediately, restored on failure.
    this.items = this.items.filter((it) => it.playlistItemID !== playlistItemID)
    try {
      await this.plex.playlistRemoveItem({ serverId: sid, ratingKey, playlistItemID })
      this.remirrorIfMirrored(ratingKey)
    } catch (err) {
      this.items = prev
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }

  /** Reorder: move `playlistItemID` to sit after `afterItemID` (null = front). */
  async moveItem(
    ratingKey: string,
    playlistItemID: number,
    afterItemID: number | null
  ): Promise<void> {
    const sid = this.serverId
    if (!sid) return
    const prev = this.items
    const moving = this.items.find((it) => it.playlistItemID === playlistItemID)
    if (!moving) return
    const rest = this.items.filter((it) => it.playlistItemID !== playlistItemID)
    const at = afterItemID === null ? 0 : rest.findIndex((it) => it.playlistItemID === afterItemID) + 1
    this.items = [...rest.slice(0, at), moving, ...rest.slice(at)]
    try {
      await this.plex.playlistMoveItem({ serverId: sid, ratingKey, playlistItemID, afterItemID })
      this.remirrorIfMirrored(ratingKey)
    } catch (err) {
      this.items = prev
      this.#deps.flashToast('err', err instanceof Error ? err.message : String(err))
    }
  }
}
