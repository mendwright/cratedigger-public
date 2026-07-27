<script lang="ts">
  import { plexState } from '../lib/plex-state.svelte'
  import BackButton from '../lib/BackButton.svelte'
  import SpotifyImportPanel from '../lib/SpotifyImportPanel.svelte'
  import { PUBLIC_BUILD } from '../../../shared/build-flags'
  import { fmtMs } from '../lib/format'
  import { rulesAreEmpty, selectAlbums, type SmartMatchDeps } from '../../../shared/playlist-rules'
  import { stripEditionSuffix } from '../../../shared/title-match'
  import { importedPlaylistRows } from '../../../shared/imported-playlist'
  import type { AlbumDetail, PlaylistItem, PlexAlbum, SmartPlaylistDef } from '../../../shared/plex'

  const ctl = $derived(plexState.playlistsCtl)
  const lists = $derived(ctl.playlists)
  const open = $derived(ctl.open)
  const items = $derived(ctl.items)

  // The source import is canonical: Plex only contains its playable subset.
  // Ordered reports let missing source tracks remain inline where they belong.
  const openImportReport = $derived.by(() => {
    const rk = ctl.openRatingKey
    if (!rk) return null
    return plexState.spotifyImport.reports.find((r) => r.plexRatingKey === rk) ?? null
  })

  // Playlists materialized from a Cratedigger smart definition get a badge
  // and (in chunk 4) a rules editor; Plex-native smart playlists (made in
  // Plexamp) are shown but read-only.
  const isSmartMaterialized = (rk: string): boolean => ctl.smartDefFor(rk) !== null

  function fmtTotal(ms: number | null): string {
    if (!ms) return ''
    const min = Math.round(ms / 60000)
    return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`
  }

  // --- New playlist ---
  let creating = $state(false)
  let newName = $state('')
  async function submitCreate(e: Event): Promise<void> {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    creating = false
    newName = ''
    const created = await ctl.create(name, [])
    if (created) void ctl.openDetail(created.ratingKey)
  }

  // --- Rename ---
  let renaming = $state(false)
  let renameDraft = $state('')
  function startRename(): void {
    if (!open) return
    renameDraft = open.title
    renaming = true
  }
  async function submitRename(e: Event): Promise<void> {
    e.preventDefault()
    if (!open) return
    renaming = false
    if (renameDraft.trim() && renameDraft.trim() !== open.title) {
      await ctl.rename(open.ratingKey, renameDraft)
    }
  }

  // --- Delete (arm/confirm, same pattern as triage) ---
  let pendingDelete = $state<string | null>(null)
  function armDelete(rk: string): void {
    pendingDelete = rk
    setTimeout(() => {
      if (pendingDelete === rk) pendingDelete = null
    }, 4000)
  }

  // --- In-playlist filter ---
  let filter = $state('')
  const visibleRows = $derived.by(() => {
    const q = filter.trim().toLowerCase()
    const rows = importedPlaylistRows(openImportReport, items)
    if (!q) return rows
    return rows.filter((row) => {
      const track = row.kind === 'matched' ? row.item : row.source
      return track.title.toLowerCase().includes(q) ||
        track.artist.toLowerCase().includes(q) ||
        track.album.toLowerCase().includes(q)
    })
  })

  // --- Drag reorder (disabled while filtered — indices would lie) ---
  let dragId = $state<number | null>(null)
  function onDrop(target: PlaylistItem): void {
    if (dragId === null || !open || filter.trim()) return
    if (target.playlistItemID === dragId) return
    void ctl.moveItem(open.ratingKey, dragId, target.playlistItemID)
    dragId = null
  }
  function onDropFront(): void {
    if (dragId === null || !open || filter.trim()) return
    void ctl.moveItem(open.ratingKey, dragId, null)
    dragId = null
  }

  // --- Side-by-side builder ------------------------------------------------
  // A library search pane next to the track list so a playlist can be built
  // without leaving the screen. Album rows add whole albums; expanding a row
  // fetches its tracks for one-by-one adds.
  let builderOpen = $state(false)
  let builderQuery = $state('')
  let expandedKey = $state<string | null>(null)
  let expandedDetail = $state<AlbumDetail | null>(null)
  let expandedLoading = $state(false)

  $effect(() => {
    if (builderOpen) void plexState.ensureAllAlbumsLoaded()
  })
  // The builder is per-playlist context — reset it when switching lists.
  $effect(() => {
    void ctl.openRatingKey
    builderOpen = false
    builderQuery = ''
    expandedKey = null
    expandedDetail = null
  })

  const builderMatches = $derived.by(() => {
    if (!builderOpen) return []
    const q = builderQuery.trim().toLowerCase()
    const all = plexState.allAlbums ?? []
    if (!q) return []
    const out: PlexAlbum[] = []
    for (const a of all) {
      if (a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)) {
        out.push(a)
        if (out.length >= 40) break
      }
    }
    return out
  })

  async function toggleExpand(a: PlexAlbum): Promise<void> {
    if (expandedKey === a.ratingKey) {
      expandedKey = null
      expandedDetail = null
      return
    }
    expandedKey = a.ratingKey
    expandedDetail = null
    const s = plexState.session
    const sid = s?.signedIn ? s.preferredServerId : null
    if (!sid) return
    expandedLoading = true
    try {
      const detail = await window.cratedigger.plex.getAlbumDetail({
        serverId: sid,
        ratingKey: a.ratingKey
      })
      if (expandedKey === a.ratingKey) expandedDetail = detail
    } catch {
      // row just stays collapsed-looking; adding the whole album still works
    } finally {
      if (expandedKey === a.ratingKey) expandedLoading = false
    }
  }

  function addAlbumToOpen(a: PlexAlbum): void {
    if (!open) return
    void ctl.addItems(open.ratingKey, [a.ratingKey], `${a.artist} — ${a.title}`)
  }

  function addTrackToOpen(trackRatingKey: string, title: string): void {
    if (!open) return
    void ctl.addItems(open.ratingKey, [trackRatingKey], title)
  }

  // --- Smart playlists ------------------------------------------------------
  // Rules live locally; matching runs here (the renderer owns the label index
  // and effective years) and materializes into a plain Plex playlist.
  const matchDeps: SmartMatchDeps = {
    labelsFor: (rk) =>
      (plexState.labelIndex.labels[rk] ?? []).map((n) => plexState.labelAliases.canonical(n)),
    // list-all-albums already overlays MB original dates; the live override
    // map wins for years pinned this session.
    yearFor: (a) => plexState.originalYear.get(a.ratingKey) ?? a.year
  }

  let editingDef = $state<SmartPlaylistDef | null>(null)
  let spotifyOpen = $state(false)
  let genreInput = $state('')
  let labelInput = $state('')

  const allGenres = $derived.by(() => {
    const set = new Set<string>()
    for (const a of plexState.allAlbums ?? []) for (const g of a.genres) set.add(g)
    return [...set].sort((a, b) => a.localeCompare(b))
  })
  const allLabels = $derived.by(() => {
    const set = new Set<string>()
    for (const arr of Object.values(plexState.labelIndex.labels)) {
      for (const n of arr) set.add(plexState.labelAliases.canonical(n))
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  })

  const previewAlbums = $derived.by(() => {
    if (!editingDef || rulesAreEmpty(editingDef.rules)) return []
    return selectAlbums(
      plexState.allAlbums ?? [],
      editingDef.rules,
      editingDef.order,
      editingDef.limit,
      matchDeps
    )
  })

  function newSmartDef(): void {
    ctl.closeDetail()
    spotifyOpen = false
    editingDef = {
      id: crypto.randomUUID(),
      name: '',
      rules: { genres: [], labels: [], yearFrom: null, yearTo: null },
      plexRatingKey: null,
      limit: null,
      order: 'artist',
      lastSyncedAt: null
    }
    void plexState.ensureAllAlbumsLoaded()
  }

  function editSmartDef(def: SmartPlaylistDef): void {
    ctl.closeDetail()
    spotifyOpen = false
    // Draft copy — nothing persists until save.
    editingDef = { ...def, rules: { ...def.rules, genres: [...def.rules.genres], labels: [...def.rules.labels] } }
    void plexState.ensureAllAlbumsLoaded()
  }

  function addChip(kind: 'genres' | 'labels', raw: string): void {
    if (!editingDef) return
    const v = raw.trim()
    if (!v) return
    const arr = editingDef.rules[kind]
    if (!arr.some((x) => x.toLowerCase() === v.toLowerCase())) {
      editingDef.rules[kind] = [...arr, v]
    }
    if (kind === 'genres') genreInput = ''
    else labelInput = ''
  }

  function dropChip(kind: 'genres' | 'labels', v: string): void {
    if (!editingDef) return
    editingDef.rules[kind] = editingDef.rules[kind].filter((x) => x !== v)
  }

  async function saveAndSync(): Promise<void> {
    if (!editingDef) return
    const def = editingDef
    if (!def.name.trim()) return
    if (rulesAreEmpty(def.rules)) return
    def.name = def.name.trim()
    await ctl.upsertSmartDef({ ...def, rules: { ...def.rules, genres: [...def.rules.genres], labels: [...def.rules.labels] } })
    await syncDef(def)
    editingDef = null
  }

  async function syncDef(def: SmartPlaylistDef): Promise<void> {
    const albums = await plexState.ensureAllAlbumsLoaded()
    const selected = selectAlbums(albums, def.rules, def.order, def.limit, matchDeps)
    // Re-read the stored def — upsert may have run just before this.
    const live = ctl.smartDefs.find((d) => d.id === def.id) ?? def
    await ctl.syncSmartDef(live, selected.map((a) => a.ratingKey))
  }

  let pendingDefDelete = $state<string | null>(null)
  async function deleteDef(def: SmartPlaylistDef): Promise<void> {
    if (pendingDefDelete !== def.id) {
      pendingDefDelete = def.id
      setTimeout(() => {
        if (pendingDefDelete === def.id) pendingDefDelete = null
      }, 4000)
      return
    }
    pendingDefDelete = null
    if (editingDef?.id === def.id) editingDef = null
    await ctl.removeSmartDef(def.id, true)
  }

  // Keep materialized playlists in step with the library: re-sync stale
  // definitions (>1h) once per screen open.
  let autoSynced = false
  $effect(() => {
    if (autoSynced || ctl.smartDefs.length === 0) return
    autoSynced = true
    const stale = ctl.smartDefs.filter(
      (d) => d.lastSyncedAt === null || Date.now() - d.lastSyncedAt > 60 * 60 * 1000
    )
    void (async () => {
      for (const d of stale) await syncDef(d)
    })()
  })

  function rulesSummary(def: SmartPlaylistDef): string {
    const bits: string[] = []
    if (def.rules.genres.length) bits.push(def.rules.genres.join('/'))
    if (def.rules.labels.length) bits.push(def.rules.labels.join('/'))
    if (def.rules.yearFrom !== null || def.rules.yearTo !== null) {
      bits.push(`${def.rules.yearFrom ?? '…'}–${def.rules.yearTo ?? '…'}`)
    }
    if (def.limit) bits.push(`top ${def.limit}`)
    return bits.join(' · ') || 'no rules'
  }

  async function playTrackInPlaylist(it: PlaylistItem): Promise<void> {
    // Same in-queue-first courtesy as the album view: if the playlist is
    // already the active queue, just skip to the track.
    const jumped = await plexState.playback.skipToTrackInQueue(it.ratingKey)
    if (jumped) return
    if (open) void plexState.playback.requestCastPlaylist(open.ratingKey, open.title, false)
  }

  function onTrackContextMenu(e: MouseEvent, it: PlaylistItem): void {
    e.preventDefault()
    const albumRk = it.albumRatingKey
    const entries = [
      ...(albumRk
        ? [{ label: 'Open Album', onClick: () => void plexState.openAlbumDetail(albumRk) }]
        : []),
      ...(it.artist
        ? [{ label: 'Open Artist', onClick: () => void plexState.openSearchArtist(it.artist) }]
        : [])
    ]
    if (entries.length > 0) plexState.openContextMenu(e.clientX, e.clientY, entries)
  }
</script>

<section class="pl">
  <header>
    <BackButton onclick={() => plexState.closePlaylists()} />
    <div class="titles">
      <div class="label">playlists</div>
      <div class="subtitle">
        {#if ctl.loading && lists.length === 0}
          loading…
        {:else}
          {lists.length} playlist{lists.length === 1 ? '' : 's'}
        {/if}
      </div>
    </div>
    <div class="right">
      {#if creating}
        <form class="new-form" onsubmit={submitCreate}>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="text"
            placeholder="playlist name"
            bind:value={newName}
            autofocus
            onkeydown={(e) => { if (e.key === 'Escape') { creating = false; newName = '' } }}
          />
          <button type="submit" class="primary" disabled={!newName.trim()}>create</button>
        </form>
      {:else}
        <button class="secondary" onclick={() => (creating = true)}>new playlist</button>
      {/if}
      <button class="secondary" disabled={ctl.loading} onclick={() => void ctl.refresh()}>refresh</button>
    </div>
  </header>

  {#if ctl.error}
    <p class="error">{ctl.error}</p>
  {/if}

  <div class="body">
    <div class="list-col">
      {#if !ctl.loading && lists.length === 0}
        <p class="hint">no playlists yet — make one, or right-click an album for “add to playlist”.</p>
      {/if}
      <ul class="pl-list">
        {#each lists as p (p.ratingKey)}
          {@const thumb = plexState.thumbUrl(p.thumb, 120)}
          <li>
            <button
              class="pl-row"
              class:active={ctl.openRatingKey === p.ratingKey}
              onclick={() => {
                editingDef = null
                spotifyOpen = false
                void ctl.openDetail(p.ratingKey)
              }}
            >
              {#if thumb}
                <img src={thumb} alt="" loading="lazy" />
              {:else}
                <div class="pl-ph">♫</div>
              {/if}
              <div class="pl-meta">
                <div class="pl-title">
                  {p.title}
                  {#if isSmartMaterialized(p.ratingKey)}
                    <span class="smart-badge" title="Cratedigger smart playlist — rules refresh it">smart</span>
                  {:else if p.smart}
                    <span class="smart-badge plex" title="Plex-native smart playlist (read-only here)">plex smart</span>
                  {/if}
                </div>
                <div class="pl-sub">
                  {p.leafCount} track{p.leafCount === 1 ? '' : 's'}{fmtTotal(p.durationMs) ? ` · ${fmtTotal(p.durationMs)}` : ''}
                </div>
              </div>
            </button>
          </li>
        {/each}
      </ul>

      <div class="smart-head">
        <span class="smart-label">smart playlists</span>
        <button class="secondary small" onclick={newSmartDef}>new</button>
      </div>
      <div class="smart-head">
        <span class="smart-label">import — spotify &amp; apple</span>
        <button
          class="secondary small"
          class:builder-active={spotifyOpen}
          onclick={() => {
            ctl.closeDetail()
            editingDef = null
            spotifyOpen = !spotifyOpen
            if (spotifyOpen) void plexState.spotifyImport.activate()
          }}
        >
          {spotifyOpen ? 'close' : 'open'}
        </button>
      </div>
      {#if !PUBLIC_BUILD}
        <div class="smart-head">
          <span class="smart-label">mirroring</span>
          {#if ctl.mirror.connected}
            <button
              class="secondary small"
              disabled={ctl.mirrorBusy !== null}
              onclick={() => void ctl.syncAllBothWays()}
              title="Create missing playlists on both accounts and merge same-name playlists without deleting tracks"
            >
              {ctl.mirrorBusy === 'all' ? 'merging…' : 'sync all both ways'}
            </button>
            <button
              class="secondary small"
              onclick={() => void ctl.disconnectMirror()}
              title={`Signed in as ${ctl.mirror.account}. Disconnect stops future syncing (existing copies stay).`}
            >
              disconnect
            </button>
          {:else if ctl.mirrorBusy === 'auth'}
            <button class="secondary small" onclick={() => ctl.cancelMirrorAuth()}>
              waiting… cancel
            </button>
          {:else}
            <button
              class="secondary small"
              onclick={() => void ctl.connectMirror()}
              title="Sign in (in the browser) as the second Plex account — e.g. the shop's — to mirror playlists to"
            >
              connect
            </button>
          {/if}
        </div>
        {#if ctl.mirror.connected}
          <p class="hint">
            playlists marked “mirror” are kept in sync on <b>{ctl.mirror.account}</b> —
            {Object.keys(ctl.mirror.mirrored).length} mirrored.
          </p>
        {/if}
      {/if}
      {#if ctl.smartDefs.length === 0}
        <p class="hint">rules-driven playlists — genre, era, label — kept fresh automatically.</p>
      {/if}
      <ul class="pl-list">
        {#each ctl.smartDefs as def (def.id)}
          <li>
            <div class="def-row" class:active={editingDef?.id === def.id}>
              <button class="def-main" onclick={() => editSmartDef(def)} title="Edit rules">
                <div class="pl-title">{def.name || 'untitled'}</div>
                <div class="pl-sub">{rulesSummary(def)}</div>
              </button>
              <button
                class="def-btn"
                disabled={ctl.syncingDefId === def.id}
                onclick={() => void syncDef(def)}
                title="Refresh now"
                aria-label="Refresh"
              >
                {ctl.syncingDefId === def.id ? '…' : '⟳'}
              </button>
              <button
                class="def-btn danger-text"
                class:armed={pendingDefDelete === def.id}
                onclick={() => void deleteDef(def)}
                title={pendingDefDelete === def.id ? 'Click again — also deletes the Plex playlist' : 'Delete rules + playlist'}
                aria-label="Delete"
              >✕</button>
            </div>
          </li>
        {/each}
      </ul>
    </div>

    <div class="detail-col">
      {#if spotifyOpen}
        <SpotifyImportPanel />
      {:else if editingDef}
        <div class="editor">
          <div class="d-head">
            <input
              class="ed-name"
              type="text"
              placeholder="smart playlist name"
              bind:value={editingDef.name}
            />
            <div class="d-actions">
              <button
                class="primary"
                disabled={!editingDef.name.trim() || rulesAreEmpty(editingDef.rules) || ctl.syncingDefId !== null}
                onclick={() => void saveAndSync()}
              >
                {editingDef.plexRatingKey ? 'save + refresh' : 'create + fill'}
              </button>
              <button class="secondary" onclick={() => (editingDef = null)}>cancel</button>
            </div>
          </div>

          <div class="ed-grid">
            <div class="ed-field">
              <span class="ed-label">genres (any of)</span>
              <div class="chips">
                {#each editingDef.rules.genres as g (g)}
                  <button class="chip" onclick={() => dropChip('genres', g)} title="Remove">{g} ✕</button>
                {/each}
                <input
                  type="text"
                  list="pl-genres"
                  placeholder="add genre…"
                  bind:value={genreInput}
                  onchange={() => addChip('genres', genreInput)}
                  onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChip('genres', genreInput) } }}
                />
                <datalist id="pl-genres">
                  {#each allGenres as g (g)}<option value={g}></option>{/each}
                </datalist>
              </div>
            </div>

            <div class="ed-field">
              <span class="ed-label">labels (any of)</span>
              <div class="chips">
                {#each editingDef.rules.labels as l (l)}
                  <button class="chip" onclick={() => dropChip('labels', l)} title="Remove">{l} ✕</button>
                {/each}
                <input
                  type="text"
                  list="pl-labels"
                  placeholder="add label…"
                  bind:value={labelInput}
                  onchange={() => addChip('labels', labelInput)}
                  onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChip('labels', labelInput) } }}
                />
                <datalist id="pl-labels">
                  {#each allLabels as l (l)}<option value={l}></option>{/each}
                </datalist>
              </div>
            </div>

            <div class="ed-field ed-inline">
              <span class="ed-label">years</span>
              <input
                class="ed-year"
                type="number"
                placeholder="from"
                value={editingDef.rules.yearFrom ?? ''}
                oninput={(e) => { if (editingDef) editingDef.rules.yearFrom = (e.currentTarget as HTMLInputElement).value ? Number((e.currentTarget as HTMLInputElement).value) : null }}
              />
              <span class="ed-dash">–</span>
              <input
                class="ed-year"
                type="number"
                placeholder="to"
                value={editingDef.rules.yearTo ?? ''}
                oninput={(e) => { if (editingDef) editingDef.rules.yearTo = (e.currentTarget as HTMLInputElement).value ? Number((e.currentTarget as HTMLInputElement).value) : null }}
              />
              <span class="ed-note">uses original release years</span>
            </div>

            <div class="ed-field ed-inline">
              <span class="ed-label">order</span>
              <select
                value={editingDef.order}
                onchange={(e) => { if (editingDef) editingDef.order = (e.currentTarget as HTMLSelectElement).value as SmartPlaylistDef['order'] }}
              >
                <option value="artist">by artist</option>
                <option value="year">by year</option>
                <option value="added">newest additions first</option>
                <option value="random">shuffled (re-rolls each refresh)</option>
              </select>
              <span class="ed-label">album cap</span>
              <input
                class="ed-year"
                type="number"
                placeholder="none"
                value={editingDef.limit ?? ''}
                oninput={(e) => { if (editingDef) editingDef.limit = (e.currentTarget as HTMLInputElement).value ? Number((e.currentTarget as HTMLInputElement).value) : null }}
              />
            </div>
          </div>

          <div class="preview">
            {#if rulesAreEmpty(editingDef.rules)}
              <p class="hint">add at least one rule — an empty definition would match the whole library.</p>
            {:else if plexState.allAlbumsLoading && (plexState.allAlbums ?? []).length === 0}
              <p class="hint">loading library for preview…</p>
            {:else}
              <p class="preview-count">
                matches <strong>{previewAlbums.length}</strong> album{previewAlbums.length === 1 ? '' : 's'}
              </p>
              <ul class="preview-list">
                {#each previewAlbums.slice(0, 8) as a (a.ratingKey)}
                  <li>{a.artist} — {a.title}{matchDeps.yearFor(a) ? ` (${matchDeps.yearFor(a)})` : ''}</li>
                {/each}
                {#if previewAlbums.length > 8}
                  <li class="hint">… and {previewAlbums.length - 8} more</li>
                {/if}
              </ul>
            {/if}
          </div>
        </div>
      {:else if !open}
        <div class="empty-detail">
          <p><strong>Pick a playlist.</strong></p>
          <p class="hint">Choose one on the left to see its tracks — or make a new one.</p>
        </div>
      {:else}
        <div class="d-head">
          {#if renaming}
            <form class="rename-form" onsubmit={submitRename}>
              <!-- svelte-ignore a11y_autofocus -->
              <input
                type="text"
                bind:value={renameDraft}
                autofocus
                onkeydown={(e) => { if (e.key === 'Escape') (renaming = false) }}
                onblur={submitRename}
              />
            </form>
          {:else}
            <button class="d-title" onclick={startRename} title="Rename">
              {open.title}
            </button>
          {/if}
          <div class="d-actions">
            {#if ctl.smartDefFor(open.ratingKey)}
              {@const def = ctl.smartDefFor(open.ratingKey)}
              <button class="secondary" onclick={() => def && editSmartDef(def)}>edit rules</button>
            {:else}
              <button
                class="secondary"
                class:builder-active={builderOpen}
                onclick={() => (builderOpen = !builderOpen)}
                title="Search the library and add tracks side-by-side"
              >
                {builderOpen ? 'done adding' : 'add tracks'}
              </button>
            {/if}
            <button
              class="primary"
              onclick={() => void plexState.playback.requestCastPlaylist(open.ratingKey, open.title, false)}
              disabled={open.leafCount === 0}
            >
              play
            </button>
            <button
              class="secondary"
              onclick={() => void plexState.playback.requestCastPlaylist(open.ratingKey, open.title, true)}
              disabled={open.leafCount === 0}
              title="Shuffle"
            >
              shuffle
            </button>
            {#if !PUBLIC_BUILD && ctl.mirror.connected && !open.smart}
              <button
                class="secondary"
                class:mirrored={ctl.isMirrored(open.ratingKey)}
                disabled={ctl.mirrorBusy !== null}
                onclick={() => void ctl.toggleMirror(open.ratingKey)}
                title={ctl.isMirrored(open.ratingKey)
                  ? `Kept in sync on ${ctl.mirror.account} — click to stop and remove their copy`
                  : `Copy to ${ctl.mirror.account} and keep it in sync`}
              >
                {ctl.mirrorBusy === open.ratingKey
                  ? 'mirroring…'
                  : ctl.isMirrored(open.ratingKey)
                    ? `mirrored to ${ctl.mirror.account} ✓`
                    : `mirror to ${ctl.mirror.account}`}
              </button>
            {/if}
            {#if pendingDelete === open.ratingKey}
              <button class="danger confirm" onclick={() => void ctl.remove(open.ratingKey)}>
                click again to delete
              </button>
            {:else}
              <button class="danger" onclick={() => armDelete(open.ratingKey)}>delete</button>
            {/if}
          </div>
        </div>

        <div class="d-body" class:with-builder={builderOpen}>
        <div class="d-items">
        {#if visibleRows.length > 8 || filter}
          <input class="filter" type="text" placeholder="filter this playlist…" bind:value={filter} />
        {/if}

        {#if ctl.itemsError}
          <p class="error">{ctl.itemsError}</p>
        {:else if ctl.itemsLoading && visibleRows.length === 0}
          <p class="hint">loading…</p>
        {:else if visibleRows.length === 0}
          <p class="hint">empty — hit “add tracks”, or right-click anything in the library.</p>
        {:else}
          <ul
            class="tracks"
            ondragover={(e) => e.preventDefault()}
          >
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <li
              class="drop-front"
              class:visible={dragId !== null && !filter.trim()}
              ondragover={(e) => e.preventDefault()}
              ondrop={onDropFront}
            ></li>
            {#each visibleRows as row, i (`${row.kind}:${i}`)}
              {#if row.kind === 'matched'}
                {@const it = row.item}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <li
                  class="track"
                  draggable={!openImportReport?.entries && !filter.trim()}
                  class:dragging={dragId === it.playlistItemID}
                  ondragstart={() => (dragId = it.playlistItemID)}
                  ondragend={() => (dragId = null)}
                  ondragover={(e) => e.preventDefault()}
                  ondrop={() => onDrop(it)}
                  oncontextmenu={(e) => onTrackContextMenu(e, it)}
                >
                  <span class="n">{i + 1}</span>
                  <button class="t-main" onclick={() => void playTrackInPlaylist(it)} title="Play from here">
                    <div class="t-title">{it.title}</div>
                    <div class="t-sub">{it.artist}{it.album ? ` · ${it.album}` : ''}</div>
                  </button>
                  {#if it.albumRatingKey}
                    <button class="t-album" onclick={() => it.albumRatingKey && void plexState.openAlbumDetail(it.albumRatingKey)} title="Open album" aria-label="Open album">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="9"></circle>
                        <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"></circle>
                      </svg>
                    </button>
                  {/if}
                  <span class="t-dur">{it.durationMs ? fmtMs(it.durationMs) : ''}</span>
                  <button class="t-remove" onclick={() => open && void ctl.removeItem(open.ratingKey, it.playlistItemID)} title="Remove from playlist" aria-label="Remove from playlist">✕</button>
                </li>
              {:else}
                {@const g = row.source}
                {@const outcome = plexState.slskd.songBatchOutcome[`${g.artist}|${g.title}`]}
                <li class="track track-missing">
                  <span class="n">{i + 1}</span>
                  <div class="t-main">
                    <div class="t-title">{g.title}</div>
                    <div class="t-sub">{g.artist}{g.album ? ` · ${g.album}` : ''}</div>
                  </div>
                  <span class="missing-chip">missing</span>
                  {#if outcome}<span class="m-badge" class:ok={outcome === 'queued'}>{outcome === 'queued' ? 'queued ✓' : outcome === 'none' ? 'no match' : 'failed'}</span>{/if}
                  {#if !PUBLIC_BUILD}
                    <button class="m-find" onclick={() => void plexState.findGapAlbumOnSlskd(g.artist, g.title, g.album || null)} title="Search Soulseek for the full LP this song is on (resolves singles via MusicBrainz)">album</button>
                    <button class="m-find quiet" onclick={() => void plexState.findGapOnSlskd(g.artist, stripEditionSuffix(g.title))} title="Search Soulseek for just this track">song</button>
                    <button class="m-find red" onclick={() => void plexState.findGapOnRed(g.artist, g.title, g.album || null)} title="Search Redacted for the full LP in your browser">RED</button>
                  {/if}
                  <span class="t-dur">{g.durationMs ? fmtMs(g.durationMs) : ''}</span>
                </li>
              {/if}
            {/each}
          </ul>
        {/if}

        {#if openImportReport && openImportReport.gaps.length > 0}
          {@const batch = plexState.slskd.songBatch}
          <div class="missing">
            <div class="missing-head">
              missing from library ({openImportReport.gaps.length} of {openImportReport.total})
              {#if !PUBLIC_BUILD}
                <button
                  class="m-find queue-all"
                  disabled={batch?.running}
                  onclick={() => openImportReport && void plexState.slskd.queueSongs(openImportReport.gaps)}
                  title="Search Soulseek for every missing track and queue the best file for each — one search at a time, so this takes a while"
                >
                  {batch?.running ? `queueing ${batch.done}/${batch.total}…` : 'queue all songs'}
                </button>
              {/if}
              <button
                class="m-find"
                disabled={plexState.spotifyImport.progress !== null}
                onclick={() => openImportReport && void plexState.spotifyImport.reimport(openImportReport)}
                title="Re-match every track against the library (including Singles) and refill this playlist"
              >
                {plexState.spotifyImport.progress?.playlistId === openImportReport.playlistId
                  ? `re-importing ${plexState.spotifyImport.progress.done}/${plexState.spotifyImport.progress.total}…`
                  : 're-import'}
              </button>
              <span class="missing-note">
                grab them on Soulseek, tag them in via the inbox, then re-import to fill this playlist
              </span>
            </div>
            {#if !openImportReport.entries}
            <ul class="missing-list">
              {#each openImportReport.gaps as g, i (i)}
                {@const outcome = plexState.slskd.songBatchOutcome[`${g.artist}|${g.title}`]}
                <li>
                  <div class="m-meta">
                    <div class="m-title">{g.title}</div>
                    <div class="m-sub">{g.artist}{g.album ? ` · ${g.album}` : ''}</div>
                  </div>
                  {#if outcome}
                    <span class="m-badge" class:ok={outcome === 'queued'}>
                      {outcome === 'queued' ? 'queued ✓' : outcome === 'none' ? 'no match' : 'failed'}
                    </span>
                  {/if}
                  {#if !PUBLIC_BUILD}
                    <button
                      class="m-find"
                      onclick={() => void plexState.findGapAlbumOnSlskd(g.artist, g.title, g.album || null)}
                      title="Search Soulseek for the full LP this song is on (resolves singles via MusicBrainz)"
                    >
                      album
                    </button>
                    <button
                      class="m-find quiet"
                      onclick={() => void plexState.findGapOnSlskd(g.artist, stripEditionSuffix(g.title))}
                      title="Search Soulseek for just this track — use ↓ on a file in the results"
                    >
                      song
                    </button>
                    <button
                      class="m-find red"
                      onclick={() => void plexState.findGapOnRed(g.artist, g.title, g.album || null)}
                      title="Search Redacted for the full LP in your browser"
                    >
                      RED
                    </button>
                  {/if}
                </li>
              {/each}
            </ul>
            {/if}
          </div>
        {/if}
        </div>

        {#if builderOpen}
          <div class="builder">
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="filter"
              type="text"
              placeholder="search the library…"
              bind:value={builderQuery}
              autofocus
            />
            {#if plexState.allAlbumsLoading && (plexState.allAlbums ?? []).length === 0}
              <p class="hint">loading library…</p>
            {:else if builderQuery.trim() && builderMatches.length === 0}
              <p class="hint">no matches.</p>
            {:else if !builderQuery.trim()}
              <p class="hint">type to search — “+” adds the album, click a row for its tracks.</p>
            {/if}
            <ul class="b-list">
              {#each builderMatches as a (a.ratingKey)}
                {@const thumb = plexState.thumbUrl(a.thumb, 96, a.ratingKey)}
                <li>
                  <div class="b-row">
                    <button class="b-main" onclick={() => void toggleExpand(a)} title="Show tracks">
                      {#if thumb}
                        <img src={thumb} alt="" loading="lazy" />
                      {:else}
                        <div class="b-ph"></div>
                      {/if}
                      <div class="b-meta">
                        <div class="b-title">{a.title}</div>
                        <div class="b-sub">{a.artist}{a.year ? ` · ${a.year}` : ''}</div>
                      </div>
                    </button>
                    <button class="b-add" onclick={() => addAlbumToOpen(a)} title="Add whole album" aria-label={`Add ${a.title}`}>+</button>
                  </div>
                  {#if expandedKey === a.ratingKey}
                    {#if expandedLoading && !expandedDetail}
                      <p class="hint b-tracks-hint">loading tracks…</p>
                    {:else if expandedDetail}
                      <ul class="b-tracks">
                        {#each expandedDetail.tracks as t (t.ratingKey)}
                          <li>
                            <span class="b-t-title">{t.title}</span>
                            <span class="t-dur">{t.duration ? fmtMs(t.duration) : ''}</span>
                            <button class="b-add small" onclick={() => addTrackToOpen(t.ratingKey, t.title)} title="Add track" aria-label={`Add ${t.title}`}>+</button>
                          </li>
                        {/each}
                      </ul>
                    {/if}
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  .pl {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 1rem 1.25rem 90px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding-bottom: 0.9rem;
    flex-wrap: wrap;
  }
  .titles .label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--faded);
  }
  .titles .subtitle { font-size: 1.05rem; font-weight: 600; }
  .right { margin-left: auto; display: flex; gap: 0.5rem; align-items: center; }
  .new-form { display: flex; gap: 0.4rem; }
  .new-form input, .rename-form input, .filter {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: 0.4rem 0.65rem;
    font: inherit;
    color: inherit;
  }
  .error { color: var(--warn-fg); }
  .hint { color: var(--faded); font-size: 0.9rem; }
  .empty-detail {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.15rem;
    text-align: center;
    color: var(--faded);
  }

  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(240px, 340px) minmax(0, 1fr);
    gap: 1.25rem;
  }
  .list-col { overflow-y: auto; min-height: 0; }
  .pl-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .pl-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: 0.55rem 0.7rem;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    min-width: 0;
  }
  .pl-row:hover { border-color: var(--hairline-strong); }
  .pl-row.active { border-color: var(--brick); box-shadow: inset 3px 0 0 var(--brick); }
  .pl-row img, .pl-ph {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-sm);
    object-fit: cover;
    flex-shrink: 0;
    background: var(--hairline);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--faded);
  }
  .pl-meta { min-width: 0; }
  .pl-title {
    font-weight: 600;
    font-size: 0.92rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .smart-badge {
    flex-shrink: 0;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 0.1rem 0.35rem;
    border-radius: var(--radius-pill);
    background: rgba(140, 53, 34, 0.14);
    color: var(--brick);
  }
  .smart-badge.plex { background: var(--hairline); color: var(--faded); }
  .pl-sub { font-size: 0.75rem; color: var(--faded); }

  .detail-col { overflow: hidden; min-height: 0; display: flex; flex-direction: column; gap: 0.7rem; }
  .d-body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  .d-body.with-builder { grid-template-columns: minmax(0, 1fr) minmax(260px, 380px); }
  .d-items { overflow-y: auto; min-height: 0; display: flex; flex-direction: column; gap: 0.6rem; }
  .builder {
    overflow-y: auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    border-left: 1px solid var(--hairline);
    padding-left: 1rem;
  }
  .b-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .b-row { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
  .b-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    background: none;
    border: 0;
    padding: 0.25rem;
    border-radius: var(--radius-sm);
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .b-main:hover { background: var(--surface); }
  .b-main img, .b-ph {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-sm);
    object-fit: cover;
    flex-shrink: 0;
    background: var(--hairline);
  }
  .b-meta { min-width: 0; }
  .b-title { font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .b-sub { font-size: 0.72rem; color: var(--faded); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .b-add {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    color: var(--espresso);
    font-size: 1rem;
    cursor: pointer;
  }
  .b-add:hover { border-color: var(--brick); color: var(--brick); }
  .b-add.small { width: 22px; height: 22px; font-size: 0.85rem; }
  .b-tracks { list-style: none; margin: 0 0 0.4rem; padding: 0 0 0 2.7rem; }
  .b-tracks li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.15rem 0;
    min-width: 0;
  }
  .b-t-title {
    flex: 1;
    min-width: 0;
    font-size: 0.8rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .b-tracks-hint { padding-left: 2.7rem; }
  .builder-active { border-color: var(--brick) !important; color: var(--brick) !important; }
  .mirrored { border-color: var(--brick); color: var(--brick); }

  .smart-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 1.1rem 0 0.5rem;
  }
  .smart-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--faded);
  }
  .secondary.small { padding: 0.2rem 0.6rem; font-size: 0.8rem; }
  .def-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: 0.45rem 0.55rem;
    min-width: 0;
  }
  .def-row.active { border-color: var(--brick); box-shadow: inset 3px 0 0 var(--brick); }
  .def-main {
    flex: 1;
    min-width: 0;
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .def-btn {
    flex-shrink: 0;
    background: none;
    border: 0;
    color: var(--faded);
    cursor: pointer;
    padding: 0.2rem 0.35rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
  }
  .def-btn:hover { color: var(--espresso); background: var(--hairline); }
  .def-btn.danger-text:hover, .def-btn.armed { color: var(--warn-fg); background: var(--warn-bg); }

  .editor { display: flex; flex-direction: column; gap: 1rem; overflow-y: auto; min-height: 0; }
  .ed-name {
    flex: 1;
    min-width: 200px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: 0.5rem 0.7rem;
    font: inherit;
    font-size: 1.05rem;
    font-weight: 600;
    color: inherit;
  }
  .ed-grid { display: flex; flex-direction: column; gap: 0.9rem; }
  .ed-field { display: flex; flex-direction: column; gap: 0.35rem; }
  .ed-field.ed-inline { flex-direction: row; align-items: center; gap: 0.55rem; flex-wrap: wrap; }
  .ed-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--faded);
  }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
  .chip {
    background: rgba(140, 53, 34, 0.12);
    color: var(--brick);
    border: 0;
    border-radius: var(--radius-pill);
    padding: 0.25rem 0.65rem;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .chip:hover { background: rgba(140, 53, 34, 0.22); }
  .chips input, .ed-year, .editor select {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: 0.3rem 0.55rem;
    font: inherit;
    font-size: 0.85rem;
    color: inherit;
  }
  .ed-year { width: 5.5rem; }
  .ed-dash { color: var(--faded); }
  .ed-note { font-size: 0.72rem; color: var(--faded); }
  .preview {
    border-top: 1px solid var(--hairline);
    padding-top: 0.8rem;
  }
  .missing {
    margin-top: 1rem;
    padding-top: 0.8rem;
    border-top: 1px solid var(--hairline);
  }
  .missing-head {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--warn-fg);
    display: flex;
    align-items: baseline;
    gap: 0.7rem;
    flex-wrap: wrap;
    margin-bottom: 0.4rem;
  }
  .missing-note {
    text-transform: none;
    letter-spacing: normal;
    font-size: 0.75rem;
    color: var(--faded);
  }
  .missing-list { list-style: none; margin: 0; padding: 0; }
  .missing-list li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem 0.2rem;
    border-bottom: 1px solid var(--surface);
    min-width: 0;
  }
  .m-meta { flex: 1; min-width: 0; }
  .m-title { font-size: 0.88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .m-sub { font-size: 0.74rem; color: var(--faded); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .m-find {
    flex-shrink: 0;
    font: inherit;
    font-size: 0.78rem;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    color: var(--espresso);
    padding: 0.22rem 0.65rem;
    cursor: pointer;
  }
  .m-find:hover { border-color: var(--brick); color: var(--brick); }
  .m-find.quiet { border-color: transparent; color: var(--faded); }
  .m-find.quiet:hover { border-color: var(--hairline); color: var(--brick); }
  .m-find.red { border-color: transparent; color: var(--faded); letter-spacing: 0.04em; }
  .m-find.red:hover { border-color: var(--hairline); color: var(--brick); }
  .m-find.queue-all { color: var(--brick); border-color: var(--brick); }
  .m-find.queue-all:disabled { opacity: 0.7; cursor: default; }
  .m-badge {
    flex-shrink: 0;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--faded);
    background: var(--surface);
    border-radius: var(--radius-pill);
    padding: 0.12rem 0.5rem;
  }
  .m-badge.ok { color: var(--brick); background: rgba(140, 53, 34, 0.12); }

  .preview-count { margin: 0 0 0.4rem; font-size: 0.9rem; }
  .preview-list { list-style: none; margin: 0; padding: 0; font-size: 0.82rem; color: var(--faded); }
  .preview-list li { padding: 0.12rem 0; }
  .d-head { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; }
  .d-title {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    font-size: 1.25rem;
    font-weight: 650;
    color: var(--espresso);
    cursor: text;
    text-align: left;
  }
  .d-title:hover { text-decoration: underline dotted; }
  .rename-form input { font-size: 1.1rem; font-weight: 600; }
  .d-actions { margin-left: auto; display: flex; gap: 0.5rem; }
  .filter { max-width: 320px; }

  .tracks { list-style: none; margin: 0; padding: 0; }
  .drop-front { height: 4px; border-radius: var(--radius-pill); }
  .drop-front.visible { background: var(--hairline); }
  .track {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.35rem 0.4rem;
    border-bottom: 1px solid var(--surface);
    min-width: 0;
  }
  .track.dragging { opacity: 0.4; }
  .track:hover { background: var(--surface); border-radius: var(--radius-sm); }
  .track-missing {
    background: color-mix(in srgb, var(--warn-bg) 55%, transparent);
    box-shadow: inset 3px 0 0 color-mix(in srgb, var(--warn-fg) 55%, transparent);
  }
  .track-missing:hover { background: var(--warn-bg); }
  .track-missing .t-title { color: var(--warn-fg); }
  .missing-chip {
    flex-shrink: 0;
    color: var(--warn-fg);
    font-size: 0.67rem;
    text-transform: uppercase;
    letter-spacing: 0.09em;
  }
  .n {
    width: 2ch;
    text-align: right;
    color: var(--faded);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .t-main {
    flex: 1;
    min-width: 0;
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .t-title { font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t-sub { font-size: 0.75rem; color: var(--faded); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t-album {
    background: none;
    border: 0;
    color: var(--faded);
    cursor: pointer;
    padding: 0.2rem;
    opacity: 0;
  }
  .track:hover .t-album { opacity: 1; }
  .t-album:hover { color: var(--espresso); }
  .t-dur { color: var(--faded); font-size: 0.75rem; font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .t-remove {
    background: none;
    border: 0;
    color: var(--faded);
    cursor: pointer;
    padding: 0.2rem 0.4rem;
    opacity: 0;
    font-size: 0.8rem;
  }
  .track:hover .t-remove { opacity: 1; }
  .t-remove:hover { color: var(--warn-fg); }

  .primary, .secondary, .danger {
    font: inherit;
    border-radius: var(--radius-pill);
    padding: 0.4rem 0.9rem;
    cursor: pointer;
  }
  .primary {
    background: var(--espresso);
    color: var(--paper);
    border: 1px solid var(--espresso);
  }
  .primary:hover:not(:disabled) { background: var(--brick); border-color: var(--brick); }
  .primary:disabled, .secondary:disabled { opacity: 0.5; cursor: default; }
  .secondary {
    background: var(--surface);
    border: 1px solid var(--hairline);
    color: var(--espresso);
  }
  .secondary:hover:not(:disabled) { border-color: var(--hairline-strong); }
  .danger {
    background: transparent;
    border: 1px solid var(--warn-border);
    color: var(--warn-fg);
  }
  .danger.confirm { background: var(--warn-bg); }

  @media (max-width: 900px) {
    .body { grid-template-columns: 1fr; }
  }
</style>
