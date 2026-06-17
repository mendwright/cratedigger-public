<script lang="ts">
  import { plexState } from '../lib/plex-state.svelte'
  import type {
    ApplyConflict,
    ApplyResult,
    InboxFolder,
    MbCanonicalTrack,
    ReconciledRow,
    RowDecision
  } from '../../../shared/tagger'
  import type { MbReleaseCandidate } from '../../../shared/plex'
  import { fmtMs, fmtSize } from '../lib/format'
  import { countOverrides, decisionForRow, isReadyToApply, trackForRow } from '../lib/inbox-logic'

  function asConflict(r: ApplyResult | null): ApplyConflict | null {
    return r && !r.ok ? r : null
  }

  const folders = $derived(plexState.inbox.folders)
  const loading = $derived(plexState.inbox.loading)
  const error = $derived(plexState.inbox.error)
  const health = $derived(plexState.inbox.health)
  const openFolder = $derived(plexState.inbox.openFolder)
  const completeness = $derived(plexState.inbox.completeness)
  const match = $derived(plexState.inbox.match)
  const matcher = $derived(plexState.inbox.matcher)
  const preview = $derived(match?.preview ?? null)
  const decisions = $derived(match?.decisions ?? {})
  const fingerprint = $derived(plexState.inbox.fingerprint)
  // Show the fingerprint pill only for the currently-open folder — stale
  // state from a previously-opened folder shouldn't bleed through.
  const fingerprintPill = $derived(
    openFolder && fingerprint && fingerprint.folderPath === openFolder.path
      ? fingerprint
      : null
  )

  function summaryForCandidate(r: MbReleaseCandidate): string {
    const bits: string[] = []
    if (r.date) bits.push(r.date.slice(0, 4))
    if (r.country) bits.push(r.country)
    if (r.status && r.status !== 'Official') bits.push(r.status)
    if (r.trackCount !== null) bits.push(`${r.trackCount} track${r.trackCount === 1 ? '' : 's'}`)
    return bits.join(' · ')
  }

  function folderLabel(f: InboxFolder): string {
    const artist = firstTag(f, 'albumartist') ?? firstTag(f, 'artist') ?? '—'
    const album = firstTag(f, 'album') ?? f.folder
    return `${artist} — ${album}`
  }

  function firstTag(
    f: InboxFolder,
    key: 'artist' | 'albumartist' | 'album'
  ): string | null {
    for (const file of f.files) {
      const v = file.tags[key]
      if (v) return v
    }
    return null
  }

  function onSearchSubmit(e: Event): void {
    e.preventDefault()
    void plexState.inbox.runMatchSearch()
  }

  const BAD_CHARS = /[\\/:*?"<>|]/g
  function sanitize(s: string): string {
    return (s || '').replace(BAD_CHARS, '_').trim().replace(/\.+$/, '') || '_'
  }

  function destPath(track: MbCanonicalTrack, srcExt: string): string {
    if (!matcher.release || !health) return ''
    const rel = matcher.release
    const artist = sanitize(rel.albumartist)
    const album = sanitize(rel.album)
    const title = sanitize(track.title)
    const tn = track.track.toString().padStart(2, '0')
    const fname =
      rel.total_discs > 1 && track.disc
        ? `${track.disc}-${tn} - ${title}${srcExt.toLowerCase()}`
        : `${tn} - ${title}${srcExt.toLowerCase()}`
    return `${health.host_music_root}/${artist}/${album}/${fname}`
  }

  function commonDestPrefix(): string {
    if (!matcher.release || !health) return ''
    const rel = matcher.release
    return `${health.host_music_root}/${sanitize(rel.albumartist)}/${sanitize(rel.album)}/`
  }

  // Decision logic lives in src/renderer/src/lib/inbox-logic.ts (pure,
  // unit-tested — readyToApply gates a destructive file move). These are
  // thin bindings onto the component's reactive state.
  function decisionFor(row: ReconciledRow): RowDecision | null {
    return decisionForRow(row, decisions)
  }

  function rowTrack(row: ReconciledRow): MbCanonicalTrack | null {
    return trackForRow(row, decisions, matcher.release)
  }

  const overrideCount = $derived(countOverrides(preview, decisions))
  const readyToApply = $derived(isReadyToApply(preview, decisions))

  function pickLabel(p: { track_index: number; title: string } | null, rel: { tracks: MbCanonicalTrack[] }): string {
    if (!p) return '—'
    const t = rel.tracks[p.track_index - 1]
    if (!t) return `track ${p.track_index}`
    return `${t.disc > 1 ? `${t.disc}-` : ''}${t.track.toString().padStart(2, '0')}  ${t.title}`
  }

  function extOf(path: string): string {
    const i = path.lastIndexOf('.')
    return i >= 0 ? path.slice(i) : ''
  }

  function confirmDeleteFolder(f: InboxFolder, ev: MouseEvent): void {
    ev.stopPropagation()
    const ok = confirm(`delete "${f.folder}" and ${f.file_count} file${f.file_count === 1 ? '' : 's'}? this cannot be undone.`)
    if (!ok) return
    void plexState.inbox.deleteFolderByName(f.folder)
  }

  function confirmDeleteFile(path: string, name: string): void {
    const ok = confirm(`delete "${name}"? this cannot be undone.`)
    if (!ok) return
    void plexState.inbox.deleteFilesInOpen([path])
  }

  function isExt(name: string, ext: string): boolean {
    return name.toLowerCase().endsWith(`.${ext}`)
  }

  const mp3Files = $derived(
    (openFolder?.files ?? []).filter((f) => isExt(f.name, 'mp3'))
  )
  const hasFlac = $derived(
    (openFolder?.files ?? []).some((f) => isExt(f.name, 'flac'))
  )

  function confirmDeleteMp3s(): void {
    if (mp3Files.length === 0) return
    const ok = confirm(
      `delete ${mp3Files.length} mp3 file${mp3Files.length === 1 ? '' : 's'}? the flac copies stay.`
    )
    if (!ok) return
    void plexState.inbox.deleteFilesInOpen(mp3Files.map((f) => f.path))
  }

  // Strip common "copy-of" suffixes so foo.flac and foo_63912342830098792.flac
  // collapse into the same group. Covers MB-style numeric IDs, Finder-style
  // " (1)", and trailing "-N".
  function normalizedStem(name: string): string {
    const dot = name.lastIndexOf('.')
    let stem = dot >= 0 ? name.slice(0, dot) : name
    stem = stem.replace(/(?:_\d{6,}|\s*\(\d+\)|-\d{1,3})$/, '')
    return stem.trim().toLowerCase()
  }

  function extOfName(name: string): string {
    const dot = name.lastIndexOf('.')
    return dot >= 0 ? name.slice(dot).toLowerCase() : ''
  }

  const duplicateFiles = $derived.by(() => {
    const files = openFolder?.files ?? []
    const groups = new Map<string, typeof files>()
    for (const f of files) {
      const key = `${normalizedStem(f.name)}|${extOfName(f.name)}`
      const bucket = groups.get(key)
      if (bucket) bucket.push(f)
      else groups.set(key, [f])
    }
    const dups: typeof files = []
    for (const bucket of groups.values()) {
      if (bucket.length <= 1) continue
      // Keep the shortest original filename (the "clean" one); drop the rest.
      const sorted = [...bucket].sort((a, b) => a.name.length - b.name.length)
      for (let i = 1; i < sorted.length; i++) dups.push(sorted[i])
    }
    return dups
  })

  function confirmDeleteDuplicates(): void {
    if (duplicateFiles.length === 0) return
    const ok = confirm(
      `delete ${duplicateFiles.length} duplicate${duplicateFiles.length === 1 ? '' : 's'}? the shortest-named copy of each track stays.`
    )
    if (!ok) return
    void plexState.inbox.deleteFilesInOpen(duplicateFiles.map((f) => f.path))
  }

  let acousticDedupeRunning = $state(false)
  let acousticDedupeError = $state<string | null>(null)
  async function runAcousticDedupe(): Promise<void> {
    const f = plexState.inbox.openFolder
    if (!f || acousticDedupeRunning) return
    acousticDedupeRunning = true
    acousticDedupeError = null
    try {
      const result = await window.cratedigger.tagger.acousticDedupe({ name: f.folder })
      if (result.to_delete.length === 0) {
        acousticDedupeError = `no acoustic duplicates found (${result.file_count} files, ${result.unfingerprinted.length} unfingerprinted)`
        return
      }
      const ok = confirm(
        `acoustic dedupe found ${result.groups.length} duplicate group${result.groups.length === 1 ? '' : 's'} ` +
        `→ delete ${result.to_delete.length} file${result.to_delete.length === 1 ? '' : 's'}? ` +
        `the shortest filename per group stays. unfingerprinted files (${result.unfingerprinted.length}) are kept.`
      )
      if (!ok) return
      await plexState.inbox.deleteFilesInOpen(result.to_delete)
    } catch (err) {
      acousticDedupeError = err instanceof Error ? err.message : String(err)
    } finally {
      acousticDedupeRunning = false
    }
  }

  function matchStatus(): {
    tone: 'ok' | 'warn'
    line1: string
    line2: string
  } | null {
    if (!preview) return null
    if (preview.clean) {
      return {
        tone: 'ok',
        line1: 'ready to apply',
        line2: `${preview.file_count} file${preview.file_count === 1 ? '' : 's'} mapped`
      }
    }
    const disagreeCount = preview.rows.filter((r) => r.disagree).length
    const unresolved = preview.rows.filter((r) => decisionFor(r) === null).length
    const parts: string[] = []
    if (disagreeCount > 0) parts.push(`${disagreeCount} disagree${disagreeCount === 1 ? 's' : ''}`)
    if (unresolved > 0) parts.push(`${unresolved} need${unresolved === 1 ? 's' : ''} a choice`)
    if (preview.file_count !== preview.total_tracks) {
      parts.push(`${preview.file_count} files vs ${preview.total_tracks} tracks`)
    }
    return {
      tone: 'warn',
      line1: unresolved > 0 ? 'needs attention' : 'review before apply',
      line2: parts.join(' · ') || 'matcher + AcoustID disagree on some rows'
    }
  }
</script>

<section class="inbox">
  <header>
    <button class="back" onclick={() => plexState.closeInbox()} aria-label="Back to library">←</button>
    <div class="head">
      <div class="label">inbox</div>
      <div class="sub">
        slskd downloads awaiting import
        {#if health}
          · <code>{health.host_inbox_root}</code>
        {/if}
      </div>
    </div>
    <button class="refresh" onclick={() => void plexState.inbox.refresh()} disabled={loading}>
      {loading ? '…' : 'refresh'}
    </button>
  </header>

  {#if error}
    <p class="err">{error}</p>
  {:else if health && !health.inbox_root_exists}
    <p class="err">inbox directory <code>{health.host_inbox_root}</code> not mounted</p>
  {:else if loading && folders.length === 0}
    <p class="hint">loading…</p>
  {:else if folders.length === 0}
    <p class="hint">no folders pending.</p>
  {:else if openFolder === null}
    <ul class="folders">
      {#each folders as f (f.path)}
        {@const c = completeness[f.path]}
        <li>
          <button class="folder" onclick={() => plexState.inbox.openFolderDetail(f)}>
            <div class="f-title">
              {folderLabel(f)}
              {#if c}
                {#if c.status === 'complete'}
                  <span
                    class="cmp-pill cmp-complete"
                    title={`${c.audioCount} files match MusicBrainz's ${c.expectedCount} tracks`}
                  >complete</span>
                {:else if c.status === 'incomplete' && c.expectedCount !== null}
                  <span
                    class="cmp-pill cmp-incomplete"
                    title={`${c.audioCount} files, MusicBrainz expects ${c.expectedCount}`}
                  >{c.audioCount}/{c.expectedCount}</span>
                {:else if c.status === 'scanning'}
                  <span class="cmp-pill cmp-scanning" title="checking MusicBrainz…">checking…</span>
                {/if}
              {/if}
            </div>
            <div class="f-sub">
              {f.file_count} file{f.file_count === 1 ? '' : 's'} · <code>{f.folder}</code>
            </div>
          </button>
          <button
            class="f-trash"
            onclick={(e) => confirmDeleteFolder(f, e)}
            title="Delete folder"
            aria-label="Delete folder"
          >🗑</button>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="detail">
      <div class="d-head">
        <button class="close" onclick={() => plexState.inbox.closeFolderDetail()} aria-label="Back to inbox list">×</button>
        <div class="d-head-title">
          <h2>{openFolder.folder}</h2>
          <div class="sub">
            {openFolder.file_count} file{openFolder.file_count === 1 ? '' : 's'}
            {#if fingerprintPill}
              <span
                class="fp-pill fp-{fingerprintPill.status}"
                title={fingerprintPill.error ?? (
                  fingerprintPill.summary
                    ? `${fingerprintPill.summary.fingerprinted} fingerprinted, ${fingerprintPill.summary.cached} cached`
                    : 'background fingerprint'
                )}
              >
                {#if fingerprintPill.status === 'running'}
                  fingerprinting…
                {:else if fingerprintPill.status === 'ready'}
                  ✓ fingerprints ready
                {:else}
                  ! fingerprint failed
                {/if}
              </span>
            {/if}
          </div>
        </div>
        <div class="files-actions">
          {#if hasFlac && mp3Files.length > 0}
            <button class="secondary files-dedupe" onclick={confirmDeleteMp3s}>
              delete {mp3Files.length} mp3{mp3Files.length === 1 ? '' : 's'} (keep flac)
            </button>
          {/if}
          {#if duplicateFiles.length > 0}
            <button class="secondary files-dedupe" onclick={confirmDeleteDuplicates}>
              delete {duplicateFiles.length} duplicate{duplicateFiles.length === 1 ? '' : 's'} (by filename)
            </button>
          {/if}
          <button
            class="secondary files-dedupe"
            onclick={runAcousticDedupe}
            disabled={acousticDedupeRunning}
            title="Fingerprint every file with Chromaprint and group by AcoustID recording. Catches dupes whose filenames differ but whose audio is identical."
          >
            {acousticDedupeRunning ? 'fingerprinting…' : 'find duplicates (acoustic)'}
          </button>
        </div>
        {#if acousticDedupeError}
          <p class="warn" style="text-align: right; margin-top: 0.25rem;">{acousticDedupeError}</p>
        {/if}
      </div>

      <section class="files">
        <h3>files</h3>
        <ul>
          {#each openFolder.files as file (file.path)}
            <li>
              <button
                class="file-del"
                onclick={() => confirmDeleteFile(file.path, file.name)}
                title="Delete file"
                aria-label="Delete file"
              >×</button>
              <div class="fn">{file.name}</div>
              <div class="ft">
                {#if file.tags.tracknumber}<span class="tn">#{file.tags.tracknumber}</span>{/if}
                <span>{file.tags.title ?? '—'}</span>
                {#if file.tags.artist}<span class="dim">· {file.tags.artist}</span>{/if}
                <span class="size">{fmtSize(file.size)}</span>
              </div>
              {#if file.read_error}
                <div class="read-err">read: {file.read_error}</div>
              {/if}
            </li>
          {/each}
        </ul>
      </section>

      <section class="match">
        <div class="match-head">
          <h3>match on musicbrainz</h3>
          {#if matcher.release}
            <button
              class="primary big match-apply"
              onclick={() => void plexState.inbox.applyRelease()}
              disabled={match?.applying || !readyToApply}
              title="Matches files by tags + duration, double-checks with AcoustID. Surfaces a picker per row when they disagree."
            >
              {#if match?.applying}
                applying…
              {:else if preview && !preview.clean && overrideCount > 0}
                apply with these choices ({overrideCount})
              {:else}
                apply
              {/if}
            </button>
          {/if}
        </div>
        {#if match}
          <form class="search" onsubmit={onSearchSubmit}>
            <label>
              <span>artist</span>
              <input
                type="text"
                value={matcher.query.artist}
                oninput={(e) => plexState.inbox.setMatchQuery((e.currentTarget as HTMLInputElement).value, matcher.query.title)}
              />
            </label>
            <label>
              <span>album</span>
              <input
                type="text"
                value={matcher.query.title}
                oninput={(e) => plexState.inbox.setMatchQuery(matcher.query.artist, (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <button type="submit" class="primary" disabled={matcher.loading}>
              {matcher.loading ? 'searching…' : 'search'}
            </button>
          </form>

          {#if matcher.error}
            <p class="err">{matcher.error}</p>
          {:else if matcher.candidates.length > 0 && !matcher.release}
            <ul class="candidates">
              {#each matcher.candidates as c (c.mbid)}
                {@const thisLoading = matcher.releaseLoadingMbid === c.mbid}
                <li class:cand-loading={thisLoading} class:cand-dim={matcher.releaseLoading && !thisLoading}>
                  <button
                    class="cand"
                    onclick={() => void plexState.inbox.pickRelease(c.mbid)}
                    disabled={matcher.releaseLoading}
                  >
                    <div class="c-top">
                      <span class="c-title">{c.title}</span>
                      {#if c.disambiguation}
                        <span class="c-dis">({c.disambiguation})</span>
                      {/if}
                      {#if thisLoading}
                        <span class="c-loading">loading…</span>
                      {/if}
                    </div>
                    <div class="c-sub">
                      {c.artistName || '—'}
                      {#if summaryForCandidate(c)}<span class="dot">·</span>{summaryForCandidate(c)}{/if}
                    </div>
                  </button>
                  <a href={`https://musicbrainz.org/release/${c.mbid}`} target="_blank" rel="noreferrer" class="mb-link" title="Open on MusicBrainz">↗</a>
                </li>
              {/each}
            </ul>
          {:else if matcher.loading}
            <p class="hint">searching musicbrainz…</p>
          {/if}

          {#if matcher.releaseLoading}
            <p class="hint">loading release…</p>
          {:else if matcher.releaseError}
            <p class="err">{matcher.releaseError}</p>
          {:else if matcher.release}
            {@const rel = matcher.release}
            {@const status = matchStatus()}
            <div class="release">
              <div class="r-head">
                <div class="r-info">
                  <div class="r-title">{rel.album}</div>
                  <div class="r-sub">
                    {rel.albumartist}
                    {#if rel.date}<span class="dot">·</span>{rel.date.slice(0, 4)}{/if}
                    <span class="dot">·</span>{rel.tracks.length} track{rel.tracks.length === 1 ? '' : 's'}
                    {#if rel.total_discs > 1}<span class="dot">·</span>{rel.total_discs} discs{/if}
                  </div>
                </div>
                <a
                  class="mb-link"
                  href={`https://musicbrainz.org/release/${rel.release_mbid}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open on MusicBrainz"
                >↗</a>
                <button class="secondary" onclick={() => plexState.inbox.resetRelease()}>
                  change release
                </button>
              </div>

              {#if status}
                <div class="status" class:ok={status.tone === 'ok'} class:warn={status.tone === 'warn'}>
                  <strong>{status.line1}</strong>
                  <span>{status.line2}</span>
                </div>
              {/if}

              {#if match.existingAlbum}
                {@const ex = match.existingAlbum}
                <div class="dup-warn">
                  <div class="dup-text">
                    <strong>Already in your library</strong>
                    <span>
                      "{ex.title}"{#if ex.year} ({ex.year}){/if} — applying as new
                      will create a duplicate tile in Plex.
                    </span>
                  </div>
                  <button
                    class="primary dup-merge"
                    onclick={() => void plexState.inbox.addIntoExistingAlbum()}
                    disabled={match.applying}
                  >
                    {match.applying ? 'merging…' : 'add to existing album'}
                  </button>
                </div>
              {/if}

              <div class="dest-prefix">
                files will move under: <code>{commonDestPrefix()}</code>
              </div>

              {#if match.matchHint}
                <p class="warn match-hint">{match.matchHint}</p>
              {/if}

              {#if preview === null}
                <p class="hint">reconciling…</p>
              {:else}
                <table class="map">
                  <thead>
                    <tr>
                      <th>file</th>
                      <th>matcher</th>
                      <th>acoustid</th>
                      <th>pick</th>
                      <th>destination</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each preview.rows as row (row.path)}
                      {@const explicit = decisions[row.path]}
                      {@const current = decisionFor(row)}
                      {@const track = rowTrack(row)}
                      {@const conflicted = row.disagree}
                      {@const matcherCurrent = typeof current === 'number' && row.matcher_pick?.track_index === current}
                      {@const acoustidCurrent = typeof current === 'number' && row.acoustid_pick?.track_index === current}
                      <tr class:row-conflict={conflicted}>
                        <td class="cell-file">{row.name}</td>
                        <td class="cell-pick" class:pick-current={matcherCurrent}>
                          {#if row.matcher_pick}
                            <button
                              type="button"
                              class="pick-btn"
                              class:pick-active={matcherCurrent}
                              onclick={() => plexState.inbox.setRowDecision(row.path, row.matcher_pick!.track_index)}
                              title={`cost ${row.matcher_pick.cost.toFixed(2)} · ${row.matcher_pick.confident ? 'confident' : 'low confidence'}`}
                            >
                              {pickLabel(row.matcher_pick, rel)}
                            </button>
                          {:else}
                            <span class="dim">—</span>
                          {/if}
                        </td>
                        <td class="cell-pick" class:pick-current={acoustidCurrent}>
                          {#if row.acoustid_pick}
                            <button
                              type="button"
                              class="pick-btn"
                              class:pick-active={acoustidCurrent}
                              onclick={() => plexState.inbox.setRowDecision(row.path, row.acoustid_pick!.track_index)}
                              title={`AcoustID score ${(row.acoustid_pick.score * 100).toFixed(0)}%`}
                            >
                              {pickLabel(row.acoustid_pick, rel)}
                            </button>
                          {:else}
                            <span class="dim" title={row.acoustid_lookup_error ?? ''}>
                              {row.acoustid_lookup_error ? '×' : '—'}
                            </span>
                          {/if}
                        </td>
                        <td>
                          <select
                            value={explicit === undefined ? '' : explicit === 'skip' ? 'skip' : String(explicit)}
                            onchange={(e) => {
                              const v = (e.currentTarget as HTMLSelectElement).value
                              if (v === '') plexState.inbox.setRowDecision(row.path, null)
                              else if (v === 'skip') plexState.inbox.setRowDecision(row.path, 'skip')
                              else plexState.inbox.setRowDecision(row.path, parseInt(v, 10))
                            }}
                          >
                            <option value="">— default —</option>
                            <option value="skip">skip this file</option>
                            {#each rel.tracks as t, i (t.track_mbid || `${t.disc}-${t.track}`)}
                              <option value={i + 1}>{pickLabel({ track_index: i + 1, title: t.title }, rel)}{t.length_ms ? ` (${fmtMs(t.length_ms)})` : ''}</option>
                            {/each}
                          </select>
                        </td>
                        <td class="cell-dest">
                          {#if current === 'skip'}
                            <span class="dim">— skipped —</span>
                          {:else if track}
                            <code>{destPath(track, extOf(row.name))}</code>
                          {:else}
                            <span class="dim">— pick a track —</span>
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>

                {#if preview.warnings.length > 0}
                  <ul class="preview-warnings">
                    {#each preview.warnings as w}
                      <li>{w}</li>
                    {/each}
                  </ul>
                {/if}
              {/if}

              {#if asConflict(match.result)}
                {@const conflict = asConflict(match.result)!}
                <div class="conflict">
                  <strong>destination files already exist:</strong>
                  <ul>
                    {#each conflict.conflicts as c}
                      <li><code>{c.dst}</code></li>
                    {/each}
                  </ul>
                  <p class="hint">resolve these on disk, or pick a different release.</p>
                </div>
              {/if}

              {#if match.applyError}
                <p class="err">{match.applyError}</p>
              {/if}
            </div>
          {/if}
        {/if}
      </section>
    </div>
  {/if}
</section>

<style>
  .inbox {
    height: 100%;
    overflow-y: auto;
    box-sizing: border-box;
    padding: 2.5rem 2rem 6rem;
  }
  .inbox > * { max-width: 900px; margin-left: auto; margin-right: auto; }
  header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.25rem 0 1rem;
    border-bottom: 1px solid var(--hairline);
    margin-bottom: 1rem;
  }
  .back, .close {
    background: transparent;
    border: 0;
    color: var(--faded);
    font-size: 1.3rem;
    line-height: 1;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
  }
  .back:hover, .close:hover { background: var(--hairline); color: #fff; }
  .head { flex: 1; }
  .label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--faded);
  }
  .sub { color: var(--faded); font-size: 0.85rem; }
  .refresh {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--espresso);
    padding: 0.35rem 0.9rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
    font-size: 0.85rem;
  }
  .refresh:hover { border-color: var(--whisper); }
  .refresh:disabled { color: var(--faded); cursor: default; }

  .folders { list-style: none; padding: 0; margin: 0; }
  .folders li {
    display: flex;
    align-items: stretch;
    gap: 0.3rem;
  }
  .folder {
    flex: 1;
    text-align: left;
    background: var(--surface);
    border: 1px solid var(--hairline);
    padding: 0.85rem 1rem;
    border-radius: var(--radius-lg);
    color: inherit;
    cursor: pointer;
    font: inherit;
    min-width: 0;
  }
  .folder:hover { border-color: var(--hairline); background: var(--inset); }
  .folders li + li { margin-top: 0.5rem; }
  .f-trash {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--faded);
    cursor: pointer;
    font-size: 0.95rem;
    padding: 0 0.8rem;
    border-radius: var(--radius-lg);
    opacity: 0;
    transition: opacity 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  .folders li:hover .f-trash { opacity: 1; }
  .f-trash:hover { color: var(--err-fg); border-color: var(--err-fg); }
  .f-title { font-weight: 500; }
  .f-sub { color: var(--faded); font-size: 0.8rem; margin-top: 0.15rem; }
  .cmp-pill {
    display: inline-block;
    margin-left: 0.5rem;
    padding: 0.05rem 0.5rem;
    border-radius: var(--radius-pill);
    font-size: 0.68rem;
    font-weight: 500;
    text-transform: lowercase;
    letter-spacing: 0.02em;
    border: 1px solid var(--hairline);
    vertical-align: 2px;
  }
  .cmp-scanning { color: var(--faded); }
  .cmp-complete { color: var(--moss-deep, #2c5530); border-color: var(--moss, #93b39a); }
  .cmp-incomplete { color: var(--brick-deep); border-color: var(--brick); }

  .detail { display: flex; flex-direction: column; gap: 1.25rem; }
  .d-head { display: flex; align-items: center; gap: 0.75rem; }
  .d-head h2 { margin: 0; font-size: 1.1rem; font-weight: 600; }
  .d-head-title { flex: 1; min-width: 0; }

  .match-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.6rem;
  }
  .match-head h3 { margin: 0; }
  .match-apply { white-space: nowrap; }
  .fp-pill {
    display: inline-block;
    margin-left: 0.6rem;
    padding: 0.05rem 0.5rem;
    border-radius: var(--radius-pill);
    font-size: 0.7rem;
    text-transform: lowercase;
    letter-spacing: 0.02em;
    border: 1px solid var(--hairline);
    vertical-align: 1px;
  }
  .fp-running { color: var(--faded); }
  .fp-ready { color: var(--moss-deep, #2c5530); border-color: var(--moss, #93b39a); }
  .fp-error { color: var(--err-fg); border-color: var(--err-fg); }
  .pick-btn {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--espresso);
    padding: 0.2rem 0.55rem;
    border-radius: var(--radius-md);
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    text-align: left;
    line-height: 1.2;
    width: 100%;
  }
  .pick-btn:hover { border-color: var(--walnut); }
  .pick-active {
    border-color: var(--moss, #93b39a);
    background: var(--moss-wash, rgba(147, 179, 154, 0.18));
    color: var(--moss-deep, #2c5530);
  }
  .row-conflict td { background: var(--brick-wash, rgba(200, 149, 109, 0.08)); }
  .cell-pick { vertical-align: top; }
  .preview-warnings {
    margin: 0.75rem 0 0;
    padding-left: 1.1rem;
    color: var(--faded);
    font-size: 0.78rem;
  }
  .preview-warnings li { margin: 0.15rem 0; }

  .files-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .files-dedupe { white-space: nowrap; font-size: 0.8rem; }

  section h3 {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--faded);
    margin: 0 0 0.6rem;
  }

  .files ul { list-style: none; padding: 0; margin: 0; }
  .files li {
    display: grid;
    grid-template-columns: 1.5rem 1fr;
    column-gap: 0.5rem;
    padding: 0.45rem 0;
    border-bottom: 1px solid var(--hairline);
    font-size: 0.88rem;
  }
  .files li > .fn { grid-column: 2; }
  .files li > .ft { grid-column: 2; }
  .files li > .read-err { grid-column: 2; }
  .files li:last-child { border-bottom: 0; }
  .file-del {
    grid-row: 1 / span 3;
    align-self: center;
    background: transparent;
    border: 0;
    color: var(--whisper);
    font-size: 1.1rem;
    cursor: pointer;
    padding: 0;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: var(--radius-sm);
    transition: color 120ms ease, background 120ms ease;
  }
  .file-del:hover { color: var(--err-fg); background: rgba(255, 107, 107, 0.08); }
  .fn { font-weight: 500; }
  .ft { color: var(--faded); font-size: 0.8rem; margin-top: 0.15rem; display: flex; gap: 0.4rem; align-items: baseline; flex-wrap: wrap; }
  .tn { color: var(--brick); font-variant-numeric: tabular-nums; }
  .dim { color: var(--faded); }
  .size { color: var(--whisper); margin-left: auto; }
  .read-err { color: var(--err-fg); font-size: 0.78rem; margin-top: 0.2rem; }

  .search {
    display: grid;
    grid-template-columns: 1fr 2fr auto;
    gap: 0.5rem;
    margin-bottom: 0.85rem;
  }
  .search label { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
  .search label span {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--faded);
  }
  .search input, .map select {
    background: var(--paper);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: 0.4rem 0.6rem;
    color: var(--espresso);
    font: inherit;
    font-size: 0.9rem;
    min-width: 0;
  }
  .search input:focus { outline: none; border-color: var(--brick); }

  .primary {
    background: var(--brick);
    color: var(--inset);
    border: 0;
    padding: 0.45rem 0.9rem;
    border-radius: var(--radius-pill);
    font-weight: 600;
    cursor: pointer;
    align-self: end;
  }
  .primary.big { padding: 0.6rem 1.2rem; font-size: 0.95rem; }
  .primary:disabled { background: var(--hairline); color: var(--faded); cursor: default; }

  .candidates { list-style: none; padding: 0; margin: 0.5rem 0 1rem; max-height: 320px; overflow-y: auto; }
  .candidates li { display: flex; gap: 0.25rem; align-items: stretch; border-radius: var(--radius-md); }
  .candidates li + li { margin-top: 0.15rem; }
  .cand {
    flex: 1;
    text-align: left;
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    padding: 0.55rem 0.75rem;
    border-radius: var(--radius-md);
    font: inherit;
  }
  .cand:hover:not(:disabled) { background: var(--hairline); }
  .cand:disabled { opacity: 0.5; cursor: default; }
  .cand-dim .cand { opacity: 0.3; }
  .cand-loading .cand {
    opacity: 1;
    background: var(--moss-wash, rgba(147, 179, 154, 0.2));
    border-color: var(--moss, #93b39a);
  }
  .cand-loading .cand:disabled { opacity: 1; cursor: progress; }
  .c-loading {
    margin-left: 0.5rem;
    font-size: 0.75rem;
    color: var(--moss-deep, #2c5530);
    text-transform: lowercase;
    letter-spacing: 0.04em;
  }
  .c-top { display: flex; gap: 0.4rem; align-items: baseline; }
  .c-title { font-size: 0.92rem; font-weight: 500; }
  .c-dis { color: var(--faded); font-size: 0.8rem; }
  .c-sub { color: var(--faded); font-size: 0.8rem; margin-top: 0.15rem; }
  .dot { margin: 0 0.4rem; color: var(--whisper); }
  .mb-link { align-self: center; color: var(--faded); text-decoration: none; padding: 0 0.5rem; font-size: 0.85rem; }
  .mb-link:hover { color: var(--brick); }

  .release {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: 1rem;
    margin-top: 0.5rem;
  }
  .r-head { display: flex; justify-content: space-between; gap: 0.75rem; align-items: flex-start; margin-bottom: 0.75rem; }
  .r-info { flex: 1; min-width: 0; }
  .r-title { font-weight: 600; }
  .r-sub { color: var(--faded); font-size: 0.85rem; margin-top: 0.15rem; }
  .secondary {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--espresso);
    padding: 0.3rem 0.8rem;
    border-radius: var(--radius-pill);
    font-size: 0.8rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .secondary:hover { border-color: var(--whisper); }

  .status {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
    padding: 0.55rem 0.8rem;
    border-radius: var(--radius-md);
    font-size: 0.85rem;
    margin-bottom: 0.75rem;
  }
  .status.ok { background: var(--ok-bg); border: 1px solid var(--ok-border); color: var(--ok-fg); }
  .status.warn { background: var(--brick-wash); border: 1px solid var(--brick); color: var(--brick-deep); }
  .status strong { font-weight: 600; }
  .status span { color: inherit; opacity: 0.8; }

  .dup-warn {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    padding: 0.7rem 0.9rem;
    border-radius: var(--radius-md);
    margin-bottom: 0.75rem;
    background: var(--brick-wash);
    border: 1px solid var(--brick);
    color: var(--brick-deep);
    font-size: 0.85rem;
  }
  .dup-text { flex: 1; display: flex; flex-direction: column; gap: 0.15rem; }
  .dup-text strong { font-weight: 600; }
  .dup-text span { opacity: 0.85; }
  .dup-merge { white-space: nowrap; flex-shrink: 0; }

  .dest-prefix {
    font-size: 0.8rem;
    color: var(--faded);
    margin-bottom: 0.75rem;
  }
  .dest-prefix code { color: var(--walnut); }

  .cell-dest { font-size: 0.78rem; color: var(--faded); max-width: 360px; word-break: break-all; }
  .cell-dest code { background: transparent; padding: 0; color: var(--faded); }
  .cell-conf { font-size: 0.78rem; }
  .conf {
    display: inline-block;
    padding: 0.05rem 0.45rem;
    border-radius: var(--radius-xs);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    border: 1px solid transparent;
  }
  .conf-ok { color: var(--moss-deep, var(--ok-fg, #2c5530)); border-color: var(--moss, #93b39a); }
  .conf-warn { color: var(--brick-deep, var(--warn-fg)); border-color: var(--brick, #c8956d); }
  .conf-bad { color: var(--err-fg); border-color: var(--err-fg); }
  .match-hint { margin-bottom: 0.6rem; }

  .map {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  .map th {
    text-align: left;
    font-weight: 500;
    color: var(--faded);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid var(--hairline);
  }
  .map td { padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--hairline); vertical-align: middle; }
  .map tr:last-child td { border-bottom: 0; }
  .cell-file { color: var(--espresso); }
  .map select { width: 100%; }

  .warn { color: var(--brick); font-size: 0.8rem; margin: 0.75rem 0 0; }
  .conflict { margin-top: 1rem; color: var(--err-fg); font-size: 0.85rem; }
  .conflict ul { margin: 0.3rem 0 0 0; padding-left: 1.2rem; }
  .conflict code { color: var(--warn-fg); font-size: 0.78rem; }


  .hint { color: var(--faded); padding: 0.5rem 0; margin: 0; font-size: 0.88rem; }
  .err { color: var(--err-fg); padding: 0.5rem 0; margin: 0; font-size: 0.88rem; }
  code { color: var(--walnut); background: var(--paper); padding: 0.1rem 0.3rem; border-radius: var(--radius-xs); font-size: 0.78rem; }
</style>
