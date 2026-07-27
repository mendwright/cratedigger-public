<script lang="ts">
  import { plexState } from '../lib/plex-state.svelte'
  import BackButton from '../lib/BackButton.svelte'
  import {
    buildDuplicateGroups,
    pickBestInGroup,
    albumSourceRoot
  } from '../../../shared/duplicates'
  import type { PlexAlbum } from '../../../shared/plex'
  import { firstMbid } from '../../../shared/guid'
  import { fmtBitrate, fmtIsoDate, fmtMs, fmtSize } from '../lib/format'
  import { isTextTarget, overlayOwnsKeys } from '../lib/keys'

  type Flag = 'no-year' | 'no-cover' | 'tracks-mismatch'

  function albumFlags(album: PlexAlbum, counts: Record<string, number>): Flag[] {
    const out: Flag[] = []
    if (!album.year) out.push('no-year')
    if (!album.thumb) out.push('no-cover')
    const mbid = firstMbid(album.guids)
    if (mbid !== null && album.trackCount !== null) {
      const mb = counts[mbid]
      if (typeof mb === 'number' && mb !== album.trackCount) out.push('tracks-mismatch')
    }
    return out
  }

  function sortKey(a: PlexAlbum): string {
    const artist = a.artist.toLowerCase().replace(/^the\s+/, '')
    return `${artist}\u0001${a.title.toLowerCase()}`
  }

  function letterBucket(artist: string): string {
    const trimmed = artist.toLowerCase().replace(/^the\s+/, '').trim()
    const c = trimmed.charAt(0).toUpperCase()
    if (c >= 'A' && c <= 'Z') return c
    return '#'
  }

  const loading = $derived(plexState.triage.loading || plexState.allAlbumsLoading)
  const allAlbums = $derived(plexState.allAlbums ?? [])
  const filters = $derived(plexState.triage.filters)
  const deletedAlbums = $derived(plexState.deletedAlbums)
  const deletingRk = $derived(plexState.deletingRatingKey)
  const counts = $derived(plexState.triage.mbTrackCounts)
  const scan = $derived(plexState.triage.scan)
  const mediaInfo = $derived(plexState.mediaInfo.byAlbum)
  const mediaScan = $derived(plexState.mediaInfo.scan)
  const mode = $derived(plexState.triage.mode)
  const mistaggedScan = $derived(plexState.triage.mistaggedScan)
  const mistaggedRepairs = $derived(plexState.triage.mistaggedRepairs)

  function fileBasename(p: string): string {
    const i = p.lastIndexOf('/')
    return i >= 0 ? p.slice(i + 1) : p
  }
  function albumDir(items: { path: string }[]): string {
    if (items.length === 0) return ''
    const first = items[0].path
    const i = first.lastIndexOf('/')
    return i >= 0 ? first.slice(0, i) : ''
  }

  const dupDismissals = $derived(plexState.triage.dupDismissals)
  const reviewedAlbums = $derived(plexState.triage.reviewedAlbums)
  let showApproved = $state(false)

  // Reviewed if the marker exists AND every current flag is in ignoredFlags.
  // A new flag (regression) busts the marker — album resurfaces for re-review.
  function isApproved(ratingKey: string, currentFlags: Flag[]): boolean {
    const entry = reviewedAlbums[ratingKey]
    if (!entry) return false
    const ignored = new Set(entry.ignoredFlags)
    return currentFlags.every((f) => ignored.has(f))
  }
  const allDupGroups = $derived(mode === 'duplicates' ? buildDuplicateGroups(allAlbums) : [])
  const dupGroups = $derived(allDupGroups.filter((g) => !dupDismissals.has(g.key)))
  const dismissedGroups = $derived(allDupGroups.filter((g) => dupDismissals.has(g.key)))
  const dupAlbumTotal = $derived(
    dupGroups.reduce((n, g) => n + g.albums.length, 0)
  )

  const flagged = $derived.by(() => {
    const rows: { album: PlexAlbum; flags: Flag[]; mbCount: number | null }[] = []
    for (const a of allAlbums) {
      const fs = albumFlags(a, counts)
      if (fs.length === 0) continue
      const keep = fs.some((f) => filters.has(f))
      if (!keep) continue
      const approved = isApproved(a.ratingKey, fs)
      if (showApproved ? !approved : approved) continue
      const mbid = firstMbid(a.guids)
      const mb = mbid ? counts[mbid] : undefined
      rows.push({ album: a, flags: fs, mbCount: typeof mb === 'number' ? mb : null })
    }
    rows.sort((x, y) => sortKey(x.album).localeCompare(sortKey(y.album)))
    return rows
  })

  const approvedCount = $derived.by(() => {
    let n = 0
    for (const a of allAlbums) {
      const fs = albumFlags(a, counts)
      if (fs.length === 0) continue
      if (isApproved(a.ratingKey, fs)) n++
    }
    return n
  })

  const grouped = $derived.by(() => {
    const map = new Map<string, { album: PlexAlbum; flags: Flag[]; mbCount: number | null }[]>()
    for (const row of flagged) {
      const k = letterBucket(row.album.artist)
      const bucket = map.get(k)
      if (bucket) bucket.push(row)
      else map.set(k, [row])
    }
    const order = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')]
    return order.filter((k) => map.has(k)).map((k) => ({ letter: k, rows: map.get(k)! }))
  })

  const totalProblem = $derived(flagged.length)
  const totalAlbums = $derived(allAlbums.length)

  let pendingDelete = $state<string | null>(null)
  let showDeletedPanel = $state(false)
  let showDismissedPanel = $state(false)

  function armDelete(ratingKey: string): void {
    pendingDelete = ratingKey
    setTimeout(() => {
      if (pendingDelete === ratingKey) pendingDelete = null
    }, 4000)
  }

  async function confirmDelete(ratingKey: string): Promise<void> {
    pendingDelete = null
    await plexState.deleteAlbumFromLibrary(ratingKey, null)
  }

  function scrollToLetter(l: string): void {
    const el = document.getElementById(`tri-letter-${l}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // --- Keyboard triage (flags mode) ---------------------------------------
  // j/k (or arrows) walk a selection through the flagged list in display
  // order; Enter opens the album, `a` approves, `d d` deletes (same 4s
  // arm/confirm as the mouse path). When an action removes the selected row,
  // the selection holds its *position* so a backlog clears without re-homing.
  let selKey = $state<string | null>(null)
  const selIndex = $derived(
    selKey === null ? -1 : flagged.findIndex((r) => r.album.ratingKey === selKey)
  )
  let lastSelIndex = 0
  $effect(() => {
    if (selIndex >= 0) lastSelIndex = selIndex
  })
  // Re-home the selection when its row leaves the list (approved, deleted,
  // filtered away): same position, clamped to the new length.
  $effect(() => {
    if (selKey === null) return
    if (flagged.length === 0) {
      selKey = null
      return
    }
    if (selIndex < 0) {
      selKey = flagged[Math.min(lastSelIndex, flagged.length - 1)].album.ratingKey
      keepSelVisible()
    }
  })

  function keepSelVisible(): void {
    queueMicrotask(() => {
      if (selKey === null) return
      document
        .querySelector(`[data-tri-row="${CSS.escape(selKey)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
  }

  function moveSel(delta: number): void {
    if (flagged.length === 0) return
    const next =
      selIndex < 0
        ? delta > 0
          ? 0
          : flagged.length - 1
        : Math.max(0, Math.min(flagged.length - 1, selIndex + delta))
    selKey = flagged[next].album.ratingKey
    keepSelVisible()
  }

  function onTriageKey(e: KeyboardEvent): void {
    if (mode !== 'flags') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (isTextTarget(e) || overlayOwnsKeys()) return
    const sel = selIndex >= 0 ? flagged[selIndex] : null
    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        e.preventDefault()
        moveSel(1)
        return
      case 'k':
      case 'ArrowUp':
        e.preventDefault()
        moveSel(-1)
        return
      case 'Enter':
      case 'o':
        if (!sel) return
        e.preventDefault()
        void plexState.openAlbumDetail(sel.album.ratingKey)
        return
      case 'a':
        if (!sel) return
        e.preventDefault()
        if (showApproved) void plexState.triage.unmarkAlbumReviewed(sel.album.ratingKey)
        else void plexState.triage.markAlbumReviewed(sel.album.ratingKey, sel.flags)
        return
      case 'd':
        if (!sel) return
        e.preventDefault()
        if (pendingDelete === sel.album.ratingKey) void confirmDelete(sel.album.ratingKey)
        else armDelete(sel.album.ratingKey)
        return
      case 'Escape':
        if (pendingDelete !== null) {
          pendingDelete = null
        } else if (selKey !== null) {
          selKey = null
        }
        return
    }
  }

  function copyDeletedToClipboard(): void {
    const lines = deletedAlbums.map((d) => {
      const parts = [d.artist, '—', d.title]
      if (d.year) parts.push(`(${d.year})`)
      if (d.mbid) parts.push(`[mbid:${d.mbid}]`)
      return parts.join(' ')
    })
    void navigator.clipboard.writeText(lines.join('\n'))
  }

  const FLAG_LABEL: Record<Flag, string> = {
    'no-year': 'no year',
    'no-cover': 'no cover',
    'tracks-mismatch': 'tracks ≠ MB'
  }
</script>

<svelte:window onkeydown={onTriageKey} />

<section>
  <header>
    <BackButton onclick={() => plexState.closeTriage()} />
    <div class="titles">
      <div class="label">library triage</div>
      <div class="subtitle">
        {#if loading && allAlbums.length === 0}
          loading…
        {:else if mode === 'duplicates'}
          {dupGroups.length} dup group{dupGroups.length === 1 ? '' : 's'} · {dupAlbumTotal} albums
        {:else if mode === 'mistagged'}
          {#if mistaggedScan?.running}
            scanning on-disk audio vs MB — this takes a minute…
          {:else if mistaggedScan}
            {mistaggedScan.findings.length} flagged · {mistaggedScan.scannedAlbums} albums scanned
          {:else}
            click "scan library" — checks every MB-tagged album for duration drift
          {/if}
        {:else}
          {totalProblem} flagged · {totalAlbums} albums scanned
        {/if}
      </div>
    </div>
    <div class="mode-toggle">
      <button class="mode-btn" class:active={mode === 'flags'} onclick={() => plexState.triage.setMode('flags')}>flags</button>
      <button class="mode-btn" class:active={mode === 'duplicates'} onclick={() => plexState.triage.setMode('duplicates')}>duplicates</button>
      <button class="mode-btn" class:active={mode === 'mistagged'} onclick={() => plexState.triage.setMode('mistagged')}>mis-tagged</button>
    </div>
    {#if mode === 'flags'}
      <div class="filters">
        {#each ['no-year', 'no-cover', 'tracks-mismatch'] as f (f)}
          <button
            class="chip"
            class:active={filters.has(f as Flag)}
            onclick={() => plexState.triage.toggleFilter(f as Flag)}
          >
            {FLAG_LABEL[f as Flag]}
          </button>
        {/each}
        {#if approvedCount > 0 || showApproved}
          <button
            class="chip approved-chip"
            class:active={showApproved}
            onclick={() => (showApproved = !showApproved)}
            title={showApproved ? 'Hide approved albums' : 'Show albums you marked as fine'}
          >
            ✓ approved {approvedCount > 0 ? `(${approvedCount})` : ''}
          </button>
        {/if}
      </div>
    {/if}
    <div class="right">
      {#if mode === 'flags'}
        {#if scan?.running}
          <div class="scan-progress" title="Checking MB track counts">
            <span>{scan.done}/{scan.total}</span>
            <button class="secondary small" onclick={() => plexState.triage.cancelScan()}>stop</button>
          </div>
        {:else}
          <button class="secondary" onclick={() => void plexState.triage.runScan()} title="Fetch MB track counts for all albums with MBIDs (1/sec, cached)">
            scan MB
          </button>
        {/if}
      {:else if mode === 'mistagged'}
        <button
          class="secondary"
          disabled={mistaggedScan?.running}
          onclick={() => void plexState.triage.runMistaggedScan()}
          title="Walk /music, ffprobe every MB-tagged file, flag albums whose audio doesn't match the tags"
        >
          {mistaggedScan?.running ? 'scanning…' : mistaggedScan ? 'rescan library' : 'scan library'}
        </button>
      {:else}
        {#if mediaScan?.running}
          <div class="scan-progress" title="Fetching bitrate data">
            <span>{mediaScan.done}/{mediaScan.total}</span>
            <button class="secondary small" onclick={() => plexState.mediaInfo.cancelScan()}>stop</button>
          </div>
        {:else}
          <button class="secondary" onclick={() => void plexState.mediaInfo.runScanForDuplicates()} title="Fetch bitrate for duplicate candidates">
            {mediaScan ? 'rescan quality' : 'scan quality'}
          </button>
        {/if}
      {/if}
      {#if mode === 'duplicates' && dismissedGroups.length > 0}
        <button class="secondary" onclick={() => (showDismissedPanel = !showDismissedPanel)}>
          dismissed ({dismissedGroups.length})
        </button>
      {/if}
      <button
        class="secondary"
        disabled={loading}
        onclick={() => void plexState.reloadAllAlbums()}
        title="Re-fetch the album list from Plex. Use this after Plex finishes a rescan."
      >
        refresh
      </button>
      <button class="secondary" onclick={() => (showDeletedPanel = !showDeletedPanel)}>
        deleted {deletedAlbums.length > 0 ? `(${deletedAlbums.length})` : ''}
      </button>
    </div>
  </header>

  {#if plexState.triage.error}
    <p class="error">{plexState.triage.error}</p>
  {/if}

  <div class="body" class:dup-mode={mode === 'duplicates'}>
    {#if mode === 'flags'}
    <nav class="letters" aria-label="Jump to letter">
      {#each grouped as g (g.letter)}
        <button class="letter" onclick={() => scrollToLetter(g.letter)}>{g.letter}</button>
      {/each}
    </nav>

    <div class="list">
      {#if !loading && flagged.length === 0}
        <p class="hint">no flagged albums. library looks clean for the active filters.</p>
      {/if}
      {#if flagged.length > 0}
        <p class="kbd-hint"><kbd>j</kbd>/<kbd>k</kbd> select · <kbd>enter</kbd> open · <kbd>a</kbd> {showApproved ? 'un-approve' : 'approve'} · <kbd>d</kbd> <kbd>d</kbd> delete</p>
      {/if}
      {#each grouped as g (g.letter)}
        <h2 id={`tri-letter-${g.letter}`} class="letter-heading">{g.letter}</h2>
        <ul>
          {#each g.rows as row (row.album.ratingKey)}
            {@const src = plexState.thumbUrl(row.album.thumb, 96, row.album.ratingKey)}
            {@const busy = deletingRk === row.album.ratingKey}
            {@const armed = pendingDelete === row.album.ratingKey}
            <li class:busy class:kbd-selected={selKey === row.album.ratingKey} data-tri-row={row.album.ratingKey}>
              <button class="thumb" onclick={() => void plexState.openAlbumDetail(row.album.ratingKey)} aria-label={`Open ${row.album.title}`}>
                {#if src}
                  <img src={src} alt="" loading="lazy" />
                {:else}
                  <div class="thumb-fallback">{row.album.title.slice(0, 1)}</div>
                {/if}
              </button>
              <button class="meta" onclick={() => void plexState.openAlbumDetail(row.album.ratingKey)}>
                <div class="title">{row.album.title}</div>
                <div class="artist">
                  {row.album.artist}{row.album.year ? ` · ${row.album.year}` : ''}{row.album.trackCount !== null ? ` · ${row.album.trackCount} tracks` : ''}{row.mbCount !== null && row.mbCount !== row.album.trackCount ? ` (MB: ${row.mbCount})` : ''}
                </div>
              </button>
              <div class="flags">
                {#each row.flags as f (f)}
                  <span class="flag" data-flag={f}>{FLAG_LABEL[f]}</span>
                {/each}
              </div>
              <div class="actions">
                {#if showApproved}
                  <button
                    class="secondary small"
                    onclick={() => void plexState.triage.unmarkAlbumReviewed(row.album.ratingKey)}
                    title="Restore this album to the active flag list"
                  >
                    un-approve
                  </button>
                {:else}
                  <button
                    class="approve-btn"
                    onclick={() => void plexState.triage.markAlbumReviewed(row.album.ratingKey, row.flags)}
                    title="I've decided these flags are fine — silence this album"
                    aria-label="Approve this album"
                  >✓</button>
                {/if}
                {#if armed}
                  <button class="danger confirm" disabled={busy} onclick={() => void confirmDelete(row.album.ratingKey)}>
                    click again to delete
                  </button>
                {:else}
                  <button class="danger" disabled={busy} onclick={() => armDelete(row.album.ratingKey)}>
                    {busy ? 'deleting…' : 'delete'}
                  </button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/each}
    </div>

    {:else if mode === 'duplicates'}
      <div class="dup-list">
        {#if !loading && dupGroups.length === 0}
          <p class="hint">no duplicate albums detected.</p>
        {/if}
        {#if dupGroups.length > 0 && !mediaScan}
          <p class="hint">
            click <strong>scan quality</strong> above to fetch bitrates so we can pick the higher-res copy.
          </p>
        {/if}
        {#each dupGroups as g (g.key)}
          {@const bestRk = pickBestInGroup(g, mediaInfo)}
          <div class="dup-group">
            <div class="dup-head">
              <div class="dup-title">{g.albums[0].artist} — {g.title}</div>
              <div class="dup-right">
                <div class="dup-count">{g.albums.length} copies</div>
                <button
                  class="secondary small dismiss"
                  title="Hide this group from duplicates — they're not actually the same release"
                  onclick={() => void plexState.triage.dismissDupGroup(g.key)}
                >
                  not a duplicate
                </button>
              </div>
            </div>
            <ul class="dup-items">
              {#each g.albums as album (album.ratingKey)}
                {@const src = plexState.thumbUrl(album.thumb, 96, album.ratingKey)}
                {@const busy = deletingRk === album.ratingKey}
                {@const armed = pendingDelete === album.ratingKey}
                {@const info = mediaInfo[album.ratingKey]}
                {@const isBest = bestRk === album.ratingKey}
                {@const tc = info?.trackCount ?? album.trackCount}
                {@const sourceRoot = albumSourceRoot(info?.samplePath)}
                <li class:busy class:best={isBest}>
                  <button class="thumb" onclick={() => void plexState.openAlbumDetail(album.ratingKey)} aria-label={`Open ${album.title}`}>
                    {#if src}
                      <img src={src} alt="" loading="lazy" />
                    {:else}
                      <div class="thumb-fallback">{album.title.slice(0, 1)}</div>
                    {/if}
                  </button>
                  <button class="meta" onclick={() => void plexState.openAlbumDetail(album.ratingKey)}>
                    <div class="title">
                      {album.title}
                      {#if isBest}<span class="best-badge">keep</span>{/if}
                      {#if sourceRoot}
                        <span
                          class="source-badge"
                          class:source-redacted={sourceRoot === 'redacted'}
                          title={sourceRoot === 'redacted'
                            ? 'On the read-only redacted tree — tagger can\'t delete this'
                            : `Source tree: ${sourceRoot}`}
                        >{sourceRoot}</span>
                      {/if}
                    </div>
                    <div class="artist">
                      {album.year ? `${album.year} · ` : ''}{tc !== null ? `${tc} tracks` : '— tracks'}
                      {#if info}
                         · <span class="q">{fmtBitrate(info.avgBitrate) || '—'}</span>
                         · <span class="q">{info.codec ?? '—'}</span>
                         · <span class="q">{fmtSize(info.totalSize) || '—'}</span>
                      {:else}
                         · <span class="q dim">quality unknown</span>
                      {/if}
                    </div>
                  </button>
                  <div class="actions">
                    {#if armed}
                      <button class="danger confirm" disabled={busy} onclick={() => void confirmDelete(album.ratingKey)}>
                        click again to delete
                      </button>
                    {:else}
                      <button class="danger" disabled={busy} onclick={() => armDelete(album.ratingKey)}>
                        {busy ? 'deleting…' : 'delete'}
                      </button>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    {:else if mode === 'mistagged'}
      <div class="mistagged-list">
        {#if mistaggedScan?.error}
          <p class="error">scan failed: {mistaggedScan.error}</p>
        {/if}
        {#if !mistaggedScan}
          <p class="hint">
            Walks the whole music library and flags albums whose audio durations
            disagree with the MB tracks they're tagged as — the smoking gun for
            the blind-sort import bug. Heavy (one MB lookup per unique release,
            deduped), takes a couple minutes on a full library.
          </p>
        {/if}
        {#if mistaggedScan && mistaggedScan.findings.length === 0 && !mistaggedScan.running && !mistaggedScan.error}
          <p class="hint">no mis-tagged albums found. library audio matches its tags.</p>
        {/if}
        {#each mistaggedScan?.findings ?? [] as f (f.release_mbid + albumDir(f.items))}
          {@const dir = albumDir(f.items)}
          {@const repairState = mistaggedRepairs[dir] ?? 'idle'}
          {@const repairing = repairState === 'repairing'}
          {@const done = repairState === 'done'}
          {@const errMsg = typeof repairState === 'object' ? repairState.error : null}
          <div class="finding" class:done class:fc-drift={f.issue === 'file_count_drift'}>
            <div class="finding-head">
              <div class="finding-title">
                {f.albumartist} — {f.album}
              </div>
              <div class="finding-sub">
                <code>{dir.replace('/music/', '')}</code>
                <span class="dot">·</span>
                {#if f.issue === 'duration_mismatch'}
                  {f.mismatched_file_count}/{f.file_count} files drift
                  <span class="dot">·</span>
                  matcher cost {f.max_match_cost?.toFixed(2) ?? '—'}
                  {#if f.matcher_confident}<span class="badge ok">confident</span>{:else}<span class="badge warn">uncertain</span>{/if}
                {:else}
                  {f.file_count} files vs {f.track_count} MB tracks
                  <span class="badge warn">count mismatch — can't auto-fix</span>
                {/if}
              </div>
            </div>
            {#if f.issue === 'duration_mismatch' && f.items.length > 0}
              <ul class="mistagged-items">
                {#each f.items.slice(0, 8) as it (it.path)}
                  <li>
                    <code>{fileBasename(it.path)}</code>
                    <span class="dim">
                      tagged "{it.claimed_title ?? '?'}" ({fmtMs(it.claimed_track_duration_ms)})
                      but audio is {fmtMs(it.actual_file_duration_ms)}
                      <span class="delta">Δ {fmtMs(it.duration_delta_ms)}</span>
                    </span>
                  </li>
                {/each}
                {#if f.items.length > 8}
                  <li class="dim">…and {f.items.length - 8} more</li>
                {/if}
              </ul>
            {/if}
            {#if f.issue === 'duration_mismatch'}
              <div class="finding-actions">
                {#if done}
                  <span class="ok">repaired — re-scan to verify</span>
                {:else}
                  <button
                    class="primary"
                    disabled={repairing}
                    onclick={() => void plexState.triage.repairMistaggedAlbum(f)}
                  >
                    {repairing ? 'repairing…' : 'apply matcher proposal'}
                  </button>
                {/if}
                {#if errMsg}
                  <span class="error">{errMsg}</span>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if showDismissedPanel}
      <aside class="deleted-panel">
        <div class="deleted-header">
          <div class="label">dismissed dup groups</div>
          <button class="secondary small" onclick={() => (showDismissedPanel = false)}>close</button>
        </div>
        {#if dismissedGroups.length === 0}
          <p class="hint">nothing dismissed.</p>
        {:else}
          <ol class="deleted-list">
            {#each dismissedGroups as g (g.key)}
              <li>
                <div class="d-title">{g.albums[0].artist} — {g.title}</div>
                <div class="d-meta">
                  {g.albums.length} copies
                  <button
                    class="secondary small"
                    onclick={() => void plexState.triage.restoreDupGroup(g.key)}
                  >
                    restore
                  </button>
                </div>
              </li>
            {/each}
          </ol>
        {/if}
      </aside>
    {/if}

    {#if showDeletedPanel}
      <aside class="deleted-panel">
        <div class="deleted-header">
          <div class="label">deleted log</div>
          <button class="secondary small" onclick={() => copyDeletedToClipboard()} disabled={deletedAlbums.length === 0}>copy</button>
          <button class="secondary small" onclick={() => (showDeletedPanel = false)}>close</button>
        </div>
        {#if deletedAlbums.length === 0}
          <p class="hint">nothing deleted yet.</p>
        {:else}
          <ol class="deleted-list">
            {#each [...deletedAlbums].reverse() as d (d.ratingKey + d.deletedAt)}
              <li>
                <div class="d-title">{d.artist} — {d.title}{d.year ? ` (${d.year})` : ''}</div>
                <div class="d-meta">
                  {fmtIsoDate(d.deletedAt)}
                  {#if d.plexTrackCount !== null} · {d.plexTrackCount} tracks{/if}
                  {#if d.mbid} · <span class="d-mbid">mbid:{d.mbid}</span>{/if}
                </div>
              </li>
            {/each}
          </ol>
        {/if}
      </aside>
    {/if}
  </div>
</section>

<style>
  section {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 2.5rem 2rem 1rem;
    box-sizing: border-box;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 1rem;
    -webkit-app-region: drag;
  }
  .titles { display: flex; flex-direction: column; gap: 0.15rem; flex-shrink: 0; }
  .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--faded);
  }
  .subtitle { font-size: 1.05rem; font-weight: 600; }
  .filters { -webkit-app-region: no-drag; display: flex; gap: 0.4rem; margin-left: 1rem; }
  /* Same segmented-pill language as Charts' mode switcher — one tab style
     app-wide. */
  .mode-toggle {
    -webkit-app-region: no-drag;
    display: inline-flex;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    overflow: hidden;
    margin-left: 0.75rem;
  }
  .mode-btn {
    background: transparent;
    color: var(--walnut);
    border: 0;
    padding: 0.34rem 0.85rem;
    font-size: 0.78rem;
    cursor: pointer;
    transition: color 140ms ease, background 140ms ease;
  }
  .mode-btn:hover { color: var(--espresso); }
  .mode-btn.active {
    background: var(--brick);
    color: var(--paper);
  }
  .chip {
    background: var(--surface);
    border: 1px solid var(--hairline);
    color: var(--faded);
    padding: 0.35rem 0.85rem;
    border-radius: var(--radius-pill);
    font-size: 0.8rem;
    cursor: pointer;
  }
  .chip:hover { color: var(--espresso); }
  .chip.active {
    background: var(--surface);
    border-color: var(--brick);
    color: var(--brick);
  }
  .right { -webkit-app-region: no-drag; margin-left: auto; display: flex; gap: 0.5rem; }
  .secondary {
    background: transparent;
    color: var(--faded);
    border: 1px solid var(--hairline);
    padding: 0.4rem 0.9rem;
    border-radius: var(--radius-pill);
    font-size: 0.8rem;
    cursor: pointer;
  }
  .secondary.small { padding: 0.25rem 0.7rem; font-size: 0.75rem; }

  .body {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 1rem;
    flex: 1;
    min-height: 0;
  }
  .body.dup-mode { grid-template-columns: 1fr auto; }
  .letters {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    overflow-y: auto;
    padding-right: 0.25rem;
  }
  .letter {
    background: transparent;
    border: 0;
    color: var(--faded);
    font-size: 0.78rem;
    padding: 0.1rem 0.35rem;
    cursor: pointer;
    font-variant-numeric: tabular-nums;
  }
  .letter:hover { color: var(--brick); }

  .list { overflow-y: auto; padding-right: 0.5rem; }
  .letter-heading {
    position: sticky;
    top: 0;
    background: var(--paper);
    margin: 0;
    padding: 0.5rem 0;
    font-size: 0.85rem;
    letter-spacing: 0.15em;
    color: var(--faded);
    text-transform: uppercase;
    border-bottom: 1px solid var(--hairline);
    z-index: 1;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0 0 0.5rem 0;
  }
  li {
    display: grid;
    grid-template-columns: 48px 1fr auto auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.5rem 0.25rem;
    border-bottom: 1px solid var(--surface);
  }
  li.busy { opacity: 0.5; }
  li.kbd-selected {
    background: color-mix(in srgb, var(--brick) 7%, transparent);
    box-shadow: inset 3px 0 0 var(--brick);
    border-radius: var(--radius-sm);
  }
  .kbd-hint {
    margin: 0 0 0.5rem;
    font-size: 0.72rem;
    color: var(--faded);
  }
  .kbd-hint kbd {
    font-family: inherit;
    font-size: 0.68rem;
    padding: 0.05rem 0.3rem;
    border: 1px solid var(--hairline-strong);
    border-bottom-width: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  .thumb, .meta {
    background: transparent;
    border: 0;
    padding: 0;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font: inherit;
    min-width: 0;
  }
  .thumb {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .thumb-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--whisper);
    font-size: 1.3rem;
    font-weight: 700;
  }
  .meta { min-width: 0; }
  .title {
    font-size: 0.92rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .artist {
    font-size: 0.78rem;
    color: var(--faded);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .flags { display: flex; gap: 0.3rem; }
  .flag {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-sm);
    background: var(--hairline);
    color: var(--brick);
  }
  .flag[data-flag='no-year'] { color: var(--brick); }
  .flag[data-flag='no-cover'] { color: var(--ok-fg); }
  .flag[data-flag='tracks-mismatch'] { color: var(--err-fg); }

  .scan-progress {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.8rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--hairline);
    background: var(--surface);
    color: var(--brick);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }

  .actions { display: flex; gap: 0.35rem; }
  .danger {
    background: transparent;
    border: 1px solid var(--warn-border);
    color: var(--err-fg);
    padding: 0.3rem 0.75rem;
    border-radius: var(--radius-pill);
    font-size: 0.78rem;
    cursor: pointer;
  }
  .danger:hover:not(:disabled) {
    background: var(--warn-bg);
  }
  .danger.confirm {
    background: var(--warn-border);
    color: #fff;
    border-color: var(--warn-bg);
  }
  .danger:disabled { opacity: 0.5; cursor: default; }

  .approve-btn {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--walnut);
    padding: 0.3rem 0.6rem;
    border-radius: var(--radius-pill);
    font-size: 0.9rem;
    line-height: 1;
    cursor: pointer;
    transition: background 120ms, border-color 120ms, color 120ms;
  }
  .approve-btn:hover {
    background: var(--surface);
    border-color: var(--walnut);
    color: var(--espresso);
  }
  .approved-chip {
    margin-left: 0.4rem;
    border-style: dashed;
  }
  .approved-chip.active {
    border-style: solid;
  }

  .deleted-panel {
    width: 320px;
    border-left: 1px solid var(--hairline);
    padding-left: 1rem;
    overflow-y: auto;
  }
  .deleted-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .deleted-header .label { flex: 1; }
  .deleted-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .deleted-list li {
    display: block;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--surface);
  }
  .d-title {
    font-size: 0.85rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .d-meta {
    font-size: 0.72rem;
    color: var(--faded);
    margin-top: 0.2rem;
  }
  .d-mbid { color: var(--faded); font-variant-numeric: tabular-nums; }

  .hint { color: var(--faded); }
  .error { color: var(--err-fg); }

  .dup-list {
    grid-column: 1 / -1;
    overflow-y: auto;
    padding-right: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .dup-group {
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid var(--ink-tint-04);
    border-radius: var(--radius-xl);
    padding: 0.75rem 0.9rem;
  }
  .dup-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.4rem;
  }
  .dup-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--espresso);
  }
  .dup-count {
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--faded);
  }
  .dup-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .dup-items {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .dup-items li {
    display: grid;
    grid-template-columns: 48px 1fr auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.5rem 0.25rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    border-radius: var(--radius-md);
  }
  .dup-items li:last-child { border-bottom: 0; }
  .dup-items li.best {
    background: rgba(74, 222, 128, 0.05);
    box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.18);
    padding-left: 0.5rem;
    padding-right: 0.5rem;
  }
  .best-badge {
    display: inline-block;
    font-size: 0.62rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ok-bg);
    background: rgba(74, 222, 128, 0.14);
    border: 1px solid rgba(74, 222, 128, 0.3);
    padding: 0.05rem 0.5rem;
    border-radius: var(--radius-pill);
    margin-left: 0.5rem;
    vertical-align: middle;
    font-weight: 500;
  }
  .source-badge {
    display: inline-block;
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: lowercase;
    color: var(--walnut);
    background: var(--ink-tint-06);
    border: 1px solid var(--hairline);
    padding: 0.05rem 0.5rem;
    border-radius: var(--radius-pill);
    margin-left: 0.4rem;
    vertical-align: middle;
    font-weight: 500;
  }
  .source-badge.source-redacted {
    color: var(--brick-deep);
    background: var(--brick-wash);
    border-color: var(--brick);
  }
  .q { color: var(--walnut); font-variant-numeric: tabular-nums; }
  .q.dim { color: var(--faded); }

  .mistagged-list { display: flex; flex-direction: column; gap: 0.85rem; }
  .finding {
    padding: 0.85rem 1rem;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    transition: opacity 200ms ease;
  }
  .finding.done { opacity: 0.5; border-color: var(--ok-border); background: var(--ok-bg); }
  .finding.fc-drift { border-left: 3px solid var(--brick); }
  .finding-head { display: flex; flex-direction: column; gap: 0.2rem; margin-bottom: 0.4rem; }
  .finding-title { font-weight: 600; color: var(--espresso); }
  .finding-sub {
    color: var(--faded);
    font-size: 0.82rem;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .finding-sub code {
    background: var(--inset);
    padding: 0.1rem 0.4rem;
    border-radius: var(--radius-sm);
    color: var(--walnut);
    font-size: 0.78rem;
  }
  .mistagged-items {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.82rem;
  }
  .mistagged-items li { color: var(--espresso); }
  .mistagged-items code {
    background: transparent;
    color: var(--espresso);
    font-size: 0.78rem;
    margin-right: 0.4rem;
  }
  .mistagged-items .delta {
    color: var(--brick);
    margin-left: 0.25rem;
    font-variant-numeric: tabular-nums;
  }
  .finding-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 0.6rem;
  }
  .finding-actions .primary {
    background: var(--brick);
    color: var(--inset);
    border: 0;
    padding: 0.4rem 0.95rem;
    border-radius: var(--radius-pill);
    font-weight: 600;
    cursor: pointer;
    font-size: 0.82rem;
  }
  .finding-actions .primary:disabled {
    background: var(--hairline);
    color: var(--faded);
    cursor: default;
  }
  .finding-actions .ok { color: var(--ok-fg); font-size: 0.85rem; font-weight: 500; }
  .finding-actions .error { color: var(--err-fg); font-size: 0.82rem; }
  .badge {
    display: inline-block;
    padding: 0.05rem 0.45rem;
    border-radius: var(--radius-pill);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .badge.ok { background: var(--ok-bg); color: var(--ok-fg); border: 1px solid var(--ok-border); }
  .badge.warn { background: var(--brick-wash); color: var(--brick-deep); border: 1px solid var(--brick); }
  .dot { color: var(--whisper); }
</style>
