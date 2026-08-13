<script lang="ts">
  import { plexState } from '../lib/plex-state.svelte'
  import type { SlskdAlbumCandidate, SlskdAlbumGroup } from '../../../shared/slskd'
  import { fmtLen, fmtSize, fmtSpeed } from '../lib/format'
  import { redSearchUrl } from '../../../shared/urls'

  const config = $derived(plexState.slskd.config)
  const health = $derived(plexState.slskd.health)
  const queue = $derived(plexState.slskd.queue)
  const queueIndex = $derived(plexState.slskd.queueIndex)
  const queueSearch = $derived(plexState.slskd.queueSearchProgress)
  const current = $derived(plexState.slskd.current)
  // Lossless-first: when a finished album search has zero flac anywhere in
  // the results, hide the lossy folders behind an explicit reveal and point
  // at RED instead. Keyed per search so the reveal resets on a new query.
  const searchKey = $derived(current ? `${current.artist}|${current.album}` : '')
  const resultHasFlac = $derived(
    current?.result?.albums.some((g) =>
      [g.primary, ...g.alternates].some((c) => c.files.some((f) => f.extension === 'flac'))
    ) ?? true
  )
  let lossyRevealedFor = $state<string | null>(null)

  function openRed(): void {
    if (!current) return
    window.open(redSearchUrl(current.artist, current.album), '_blank', 'noopener,noreferrer')
  }
  const tab = $derived(plexState.slskd.tab)
  const downloads = $derived(plexState.slskd.downloads)
  const downloadsLoading = $derived(plexState.slskd.downloadsLoading)
  const downloadsError = $derived(plexState.slskd.downloadsError)
  const acquisitions = $derived(downloads?.acquisitions ?? [])
  const dlFilter = $derived(plexState.slskd.downloadsFilter)
  const successfulPeers = $derived(plexState.slskd.successfulPeers)
  const peerBrowse = $derived(plexState.slskd.peerBrowse)
  const peersLoading = $derived(plexState.slskd.peersLoading)
  const peersError = $derived(plexState.slskd.peersError)
  let browseFilter = $state('')
  let manualUsername = $state('')
  const visibleBrowseAlbums = $derived(
    (peerBrowse?.result?.albums ?? []).filter((album) => {
      const q = browseFilter.trim().toLowerCase()
      return !q || `${album.guessedArtist ?? ''} ${album.guessedAlbum ?? ''} ${album.folder}`.toLowerCase().includes(q)
    })
  )

  function includeFile(cls: 'prog' | 'ok' | 'err' | 'q' | 'x'): boolean {
    switch (dlFilter) {
      case 'all':
        return true
      case 'inProgress':
        return cls === 'prog'
      case 'queued':
        return cls === 'q'
      case 'completed':
        return cls === 'ok'
      case 'errored':
        return cls === 'err' || cls === 'x'
    }
  }

  let acqCollapsed = $state(false)
  let pasteText = $state('')
  let manualArtist = $state('')
  let manualAlbum = $state('')
  let configOpen = $state(false)
  let configUrl = $state('')
  let configKey = $state('')

  $effect(() => {
    if (config && !configOpen) {
      configUrl = config.url
      configKey = config.apiKey
    }
  })

  function onParse(): void {
    plexState.slskd.parseList(pasteText)
  }

  function onClearQueue(): void {
    plexState.slskd.clearQueue()
    pasteText = ''
  }

  function onManualSearch(e: Event): void {
    e.preventDefault()
    const a = manualArtist.trim()
    const b = manualAlbum.trim()
    if (!a && !b) return
    plexState.slskd.clearQueue()
    void plexState.slskd.runSearch(a, b)
  }

  function onSaveConfig(): void {
    void plexState.slskd.saveConfig(configUrl.trim(), configKey.trim())
    configOpen = false
  }

  function onEnqueue(c: SlskdAlbumCandidate): void {
    void plexState.slskd.enqueueCandidate(c)
  }

  function candidateKey(c: SlskdAlbumCandidate): string {
    return `${c.username}|${c.folder}`
  }

  function fmtMine(m: { downloading: number; queued: number }): string {
    const parts: string[] = []
    if (m.downloading > 0) parts.push(`${m.downloading} downloading`)
    if (m.queued > 0) parts.push(`${m.queued} queued`)
    return `you: ${parts.join(', ')}`
  }

  function basename(p: string): string {
    const parts = p.split(/[\\/]/)
    return parts[parts.length - 1] ?? p
  }

  function stateClass(state: string): 'prog' | 'ok' | 'err' | 'q' | 'x' {
    const s = state.toLowerCase()
    if (s.includes('inprogress') || s.includes('initializing')) return 'prog'
    if (s.includes('succeeded')) return 'ok'
    if (s.includes('errored') || s.includes('timedout') || s.includes('rejected')) return 'err'
    if (s.includes('cancelled')) return 'x'
    if (s.includes('queued')) return 'q'
    return 'q'
  }

  function stateLabel(state: string): string {
    return state.replace(/^Completed,\s*/, '').replace(/,\s*/g, ' · ')
  }

  function canRetry(cls: 'prog' | 'ok' | 'err' | 'q' | 'x'): boolean {
    return cls === 'err' || cls === 'x'
  }

  function confirmRemoveDir(username: string, count: number): boolean {
    return window.confirm(`Remove ${count} file${count === 1 ? '' : 's'} from ${username}?`)
  }

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function browseUsername(e: Event): void {
    e.preventDefault()
    const username = manualUsername.trim()
    if (!username) return
    browseFilter = ''
    plexState.slskd.openPeer(username)
  }
</script>

<section class="slskd">
  <header>
    <button class="back" onclick={() => plexState.closeSlskd()} aria-label="Back to library">←</button>
    <div class="head">
      <div class="label">soulseek</div>
      <div class="sub">
        {#if health?.ok}
          connected to <code>{health.url}</code>
          {#if health.version}· v{health.version}{/if}
        {:else if health}
          <span class="err-inline">not reachable: {health.error ?? 'unknown'}</span>
          <button class="retry" onclick={() => void plexState.slskd.refreshHealth()}>retry</button>
        {:else}
          checking…
        {/if}
      </div>
    </div>
    <button class="secondary" onclick={() => (configOpen = !configOpen)}>
      {configOpen ? 'close settings' : 'settings'}
    </button>
  </header>

  {#if configOpen}
    <div class="config">
      <label>
        <span>slskd url</span>
        <input bind:value={configUrl} placeholder="http://your-server:5030" />
      </label>
      <label>
        <span>api key</span>
        <input type="password" bind:value={configKey} placeholder="X-API-Key" />
      </label>
      <div class="row">
        <button class="primary" onclick={onSaveConfig}>save</button>
        <button class="secondary" onclick={() => void plexState.slskd.refreshHealth()}>test</button>
      </div>
    </div>
  {/if}

  <nav class="tabs">
    <button
      class="tab"
      class:active={tab === 'search'}
      onclick={() => plexState.slskd.setTab('search')}
    >search</button>
    <button
      class="tab"
      class:active={tab === 'downloads'}
      onclick={() => plexState.slskd.setTab('downloads')}
    >
      downloads{#if downloads && downloads.totals.files > 0}
        <span class="tab-count">
          {downloads.totals.inProgress > 0
            ? `${downloads.totals.inProgress} active`
            : `${downloads.totals.files}`}
        </span>
      {/if}
    </button>
    <button
      class="tab"
      class:active={tab === 'uploaders'}
      onclick={() => plexState.slskd.setTab('uploaders')}
    >
      uploaders{#if successfulPeers.length > 0}<span class="tab-count">{successfulPeers.length}</span>{/if}
    </button>
  </nav>

  {#if tab === 'search'}
  <div class="inputs">
    <form class="manual" onsubmit={onManualSearch}>
      <input class="f-artist" bind:value={manualArtist} placeholder="artist" />
      <input class="f-album" bind:value={manualAlbum} placeholder="album" />
      <button class="primary" type="submit">search</button>
    </form>

    <details class="bulk" open={queue.length === 0}>
      <summary>paste a list (one &quot;Artist - Album&quot; per line)</summary>
      <textarea
        bind:value={pasteText}
        rows="6"
        placeholder="Code Orange - Underneath&#10;Sweven - The Eternal Resonance&#10;…"
      ></textarea>
      <div class="row">
        <button class="primary" onclick={onParse} disabled={!pasteText.trim()}>
          queue ({pasteText.split(/\r?\n/).filter((l) => l.trim()).length} lines)
        </button>
        {#if queue.length > 0}
          <button class="secondary" onclick={onClearQueue}>clear queue</button>
        {/if}
      </div>
    </details>
  </div>

  {#if queue.length > 0}
    <div class="queue">
      <div class="q-header">
        {queueIndex + 1} / {queue.length}
        {#if queueSearch.started > 0}
          <span class="q-search-prog" class:q-search-active={queueSearch.done + queueSearch.failed < queueSearch.started}>
            searched {queueSearch.done + queueSearch.failed}/{queueSearch.started}
            {#if queueSearch.failed > 0}· <span class="t-err">{queueSearch.failed} failed</span>{/if}
            {#if queueSearch.done + queueSearch.failed < queueSearch.started}…{/if}
          </span>
        {/if}
        <button
          class="secondary"
          onclick={() => plexState.slskd.nextQueueItem()}
          disabled={queueIndex >= queue.length - 1}
        >
          skip →
        </button>
      </div>
      <ol class="q-list">
        {#each queue as item, i (`${item.artist}|${item.album}|${i}`)}
          {@const owned = plexState.slskd.ownedAlbum(item.artist, item.album)}
          <li
            class:active={i === queueIndex}
            class:done={item.status === 'enqueued'}
            class:owned
          >
            <button class="q-item" onclick={() => plexState.slskd.goToQueueItem(i)}>
              <span class="q-num">{i + 1}.</span>
              <span class="q-artist">{item.artist}</span>
              <span class="q-sep">—</span>
              <span class="q-album">{item.album}</span>
              {#if owned}
                <span class="q-owned" title="already in your Plex library">in library</span>
              {/if}
              <span class="q-status" data-status={item.status}>
                {#if item.status === 'enqueued'}✓
                {:else if item.status === 'skipped'}·
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ol>
    </div>
  {/if}

  {#if current}
    {@const owned = plexState.slskd.ownedAlbum(
      current.artist,
      current.album,
      current.result?.release?.mbid ?? null
    )}
    <div class="current">
      <div class="c-header">
        <div class="c-title">
          <span class="c-artist">{current.artist}</span>
          <span class="c-sep">—</span>
          <span class="c-album">{current.album}</span>
          {#if owned}
            <span class="owned-tell" title="this album is already in your Plex library">
              ✓ already in your library{owned.year ? ` (${owned.year})` : ''}
            </span>
          {/if}
        </div>
        {#if current.result}
          <div class="c-meta">
            {current.result.albums.length} album{current.result.albums.length === 1 ? '' : 's'}
            from {current.result.responseCount} response{current.result.responseCount === 1 ? '' : 's'}
            · {(current.result.elapsedMs / 1000).toFixed(1)}s
            {#if !current.result.complete}· (timeout){/if}
          </div>
          {#if current.result.release}
            <div class="c-mb">
              <span class="mb-label">MusicBrainz:</span>
              {current.result.release.artistName} · {current.result.release.title}
              {#if current.result.release.date}({current.result.release.date.slice(0, 4)}){/if}
              · expects {current.result.release.expectedTrackCount} track{current.result.release.expectedTrackCount === 1 ? '' : 's'}
              <button
                type="button"
                class="mb-switch"
                onclick={() => plexState.slskd.openReleasePicker()}
              >change</button>
            </div>
          {:else}
            <div class="c-mb c-mb-miss">
              no MusicBrainz match — ranking by file-count only
              <button
                type="button"
                class="mb-switch"
                onclick={() => plexState.slskd.openReleasePicker()}
              >pick release</button>
            </div>
          {/if}
        {/if}
      </div>

      {#if current.loading}
        <p class="hint">searching soulseek… (up to 90s)</p>
      {:else if current.error}
        <p class="err">{current.error}</p>
      {:else if current.result && current.result.albums.length === 0}
        <p class="hint">
          no matches passed the threshold. try different wording? or
          <button type="button" class="red-link" onclick={openRed}>search RED</button>
        </p>
      {:else if current.result && !resultHasFlac && lossyRevealedFor !== searchKey}
        <p class="hint">
          no flac files — wanna
          <button type="button" class="red-link" onclick={openRed}>search RED</button>?
          <button type="button" class="lossy-link" onclick={() => (lossyRevealedFor = searchKey)}>
            show the {current.result.albums.length} lossy result{current.result.albums.length === 1 ? '' : 's'} anyway
          </button>
        </p>
      {:else if current.result}
        <div class="result-fallback">
          <span>don’t like these results?</span>
          <button type="button" class="red-link" onclick={openRed}>search RED</button>
        </div>
        <ul class="albums">
          {#each current.result.albums as g (g.key)}
            {@const expected = current.result.release?.expectedTrackCount ?? 0}
            {@const primaryKey = candidateKey(g.primary)}
            {@const status = current.enqueueStatus[primaryKey]}
            {@const altStatus = (c: SlskdAlbumCandidate) => current.enqueueStatus[candidateKey(c)]}
            {@const complete = expected > 0 && g.primary.matchedTracks >= expected}
            {@const partial = expected > 0 && g.primary.matchedTracks < expected && g.primary.matchedTracks > 0}
            {@const mine = plexState.slskd.pendingWithPeer(g.primary.username)}
            <li
              class:enq={status === 'ok'}
              class:busy={status === 'pending'}
              class:complete
              class:partial
            >
              <div class="alb-head">
                <div class="alb-title">
                  {#if g.displayArtist}
                    <span class="alb-artist">{g.displayArtist}</span>
                    <span class="alb-sep">—</span>
                  {/if}
                  <span class="alb-name">{g.displayAlbum}</span>
                  {#if complete}
                    <span class="badge badge-ok">complete</span>
                  {:else if partial}
                    <span class="badge badge-warn">{g.primary.matchedTracks}/{expected}</span>
                  {/if}
                </div>
                <button
                  class="enq-btn"
                  class:done={status === 'ok'}
                  disabled={status === 'pending' || status === 'ok'}
                  onclick={() => onEnqueue(g.primary)}
                >
                  {#if status === 'ok'}queued ✓
                  {:else if status === 'pending'}queueing…
                  {:else if complete}download complete album ({g.primary.files.length} · {g.primary.files[0]?.extension ?? '?'})
                  {:else if partial}download partial ({g.primary.matchedTracks}/{expected} · {g.primary.files[0]?.extension ?? '?'})
                  {:else}download ({g.primary.files.length} · {g.primary.files[0]?.extension ?? '?'}){/if}
                </button>
              </div>
              <div class="alb-source">
                from <button class="user-link" onclick={() => plexState.slskd.openPeer(g.primary.username)}>{g.primary.username}</button>
                · {g.primary.formatSummary}
                {#if g.primary.hasFreeUploadSlot}· <span class="slot-ok">free slot</span>{:else}· <span class="slot-busy">queued</span>{/if}
                {#if mine.downloading > 0 || mine.queued > 0}
                  · <span class="slot-mine">{fmtMine(mine)}</span>
                {/if}
                {#if g.primary.uploadSpeed > 0}· {fmtSpeed(g.primary.uploadSpeed)}{/if}
                {#if g.primary.successfulAlbums > 0}· <span class="slot-ok">worked before ×{g.primary.successfulAlbums}</span>{/if}
                {#if g.primary.failedAlbums > 0}· <span class="slot-failed">failed before ×{g.primary.failedAlbums}</span>{/if}
                {#if expected > 0}
                  · <span class={complete ? 'slot-ok' : 'slot-busy'}>{g.primary.matchedTracks}/{expected} matched</span>
                {:else}
                  · match {(g.primary.avgMatchScore * 100).toFixed(0)}%
                {/if}
              </div>
              <details class="alb-files">
                <summary>tracklist ({g.primary.files.length})</summary>
                <ul>
                  {#each g.primary.files as f (f.filename)}
                    {@const fileStatus = current.enqueueStatus[`${g.primary.username}|${f.filename}`]}
                    <li>
                      <span class="fn">{basename(f.filename)}</span>
                      <span class="fm">
                        {f.extension}
                        {#if f.bitRate}· {f.bitRate}kbps{/if}
                        {#if f.length}· {fmtLen(f.length)}{/if}
                        · {fmtSize(f.size)}
                      </span>
                      <button
                        class="file-dl"
                        class:done={fileStatus === 'ok'}
                        disabled={fileStatus === 'pending' || fileStatus === 'ok'}
                        onclick={() => void plexState.slskd.enqueueSingleFile(g.primary, f)}
                        title="Download just this track"
                        aria-label={`Download ${basename(f.filename)}`}
                      >
                        {fileStatus === 'ok' ? '✓' : fileStatus === 'pending' ? '…' : '↓'}
                      </button>
                    </li>
                  {/each}
                </ul>
              </details>
              {#if g.alternates.length > 0}
                <details class="alb-alts">
                  <summary>{g.alternates.length} alternate source{g.alternates.length === 1 ? '' : 's'}</summary>
                  <ul>
                    {#each g.alternates as alt (candidateKey(alt))}
                      {@const st = altStatus(alt)}
                      {@const altMine = plexState.slskd.pendingWithPeer(alt.username)}
                      <li>
                        <div class="alt-line">
                          <button class="user-link" onclick={() => plexState.slskd.openPeer(alt.username)}>{alt.username}</button>
                          <span class="alb-folder">/ {alt.folder}</span>
                          <span class="alb-meta">
                            {alt.formatSummary}
                            {#if alt.hasFreeUploadSlot}· <span class="slot-ok">free</span>{:else}· <span class="slot-busy">queued</span>{/if}
                            {#if altMine.downloading > 0 || altMine.queued > 0}
                              · <span class="slot-mine">{fmtMine(altMine)}</span>
                            {/if}
                            {#if alt.uploadSpeed > 0}· {fmtSpeed(alt.uploadSpeed)}{/if}
                            {#if alt.successfulAlbums > 0}· <span class="slot-ok">worked before ×{alt.successfulAlbums}</span>{/if}
                            {#if alt.failedAlbums > 0}· <span class="slot-failed">failed before ×{alt.failedAlbums}</span>{/if}
                            · {(alt.avgMatchScore * 100).toFixed(0)}%
                          </span>
                          <button
                            class="alt-btn"
                            class:done={st === 'ok'}
                            disabled={st === 'pending' || st === 'ok'}
                            onclick={() => onEnqueue(alt)}
                          >
                            {#if st === 'ok'}✓
                            {:else if st === 'pending'}…
                            {:else}use this{/if}
                          </button>
                        </div>
                      </li>
                    {/each}
                  </ul>
                </details>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
  {:else if tab === 'downloads'}
  <!-- downloads tab -->
    <div class="downloads">
      {#if downloadsError}
        <p class="err">{downloadsError}</p>
      {/if}
      {#if acquisitions.length > 0}
        <section class="acquisitions" aria-label="Acquisition history">
          <button
            class="acq-heading"
            aria-expanded={!acqCollapsed}
            onclick={() => (acqCollapsed = !acqCollapsed)}
          >
            <span class="acq-caret" class:collapsed={acqCollapsed}>▾</span>
            album acquisitions
            <span class="acq-count">{acquisitions.length}</span>
          </button>
          {#if !acqCollapsed}
          {#each acquisitions.slice(0, 20) as job (job.id)}
            {@const imported = job.files.filter((f) => f.status === 'imported').length}
            {@const failed = job.files.filter((f) => f.status === 'failed' || f.status === 'skipped').length}
            <div class="acq-job" data-status={job.status}>
              <div class="acq-main">
                <span class="acq-artist">{job.artist}</span>
                <span class="c-sep">—</span>
                <span>{job.album}</span>
                <span class="acq-status">{job.status}</span>
              </div>
              <div class="acq-meta">
                {job.files.length} expected
                {#if imported > 0}· {imported} imported{/if}
                {#if failed > 0}· <span class="t-err">{failed} unresolved</span>{/if}
                · from <button class="user-link" onclick={() => plexState.slskd.openPeer(job.username)}>{job.username}</button>
                {#if job.releaseMbid}· manifest {job.releaseMbid.slice(0, 8)}…{/if}
              </div>
              {#if job.error}<div class="acq-error">{job.error}</div>{/if}
            </div>
          {/each}
          {/if}
        </section>
      {/if}
      {#if !downloads && downloadsLoading}
        <p class="hint">loading…</p>
      {:else if downloads && downloads.totals.files === 0}
        {#if acquisitions.length === 0}
          <p class="hint">no downloads yet. queue something from the search tab.</p>
        {/if}
      {:else if downloads}
        <div class="dl-totals">
          <button
            class="chip"
            class:active={dlFilter === 'all'}
            onclick={() => plexState.slskd.setDownloadsFilter('all')}
          >{downloads.totals.files} file{downloads.totals.files === 1 ? '' : 's'}</button>
          {#if downloads.totals.inProgress > 0}
            <button
              class="chip t-prog"
              class:active={dlFilter === 'inProgress'}
              onclick={() => plexState.slskd.setDownloadsFilter('inProgress')}
            >{downloads.totals.inProgress} in progress</button>
          {/if}
          {#if downloads.totals.queued > 0}
            <button
              class="chip t-q"
              class:active={dlFilter === 'queued'}
              onclick={() => plexState.slskd.setDownloadsFilter('queued')}
            >{downloads.totals.queued} queued</button>
          {/if}
          {#if downloads.totals.completed > 0}
            <button
              class="chip t-ok"
              class:active={dlFilter === 'completed'}
              onclick={() => plexState.slskd.setDownloadsFilter('completed')}
            >{downloads.totals.completed} complete</button>
          {/if}
          {#if downloads.totals.errored > 0}
            <button
              class="chip t-err"
              class:active={dlFilter === 'errored'}
              onclick={() => plexState.slskd.setDownloadsFilter('errored')}
            >{downloads.totals.errored} errored</button>
          {/if}
          {#if downloads.totals.completed > 0}
            <button
              class="chip clear-done"
              disabled={plexState.slskd.clearingSucceeded}
              onclick={() => void plexState.slskd.clearSucceeded()}
              title="Remove every succeeded transfer from slskd's list — the files are already on disk"
            >
              {plexState.slskd.clearingSucceeded ? 'clearing…' : 'clear all succeeded'}
            </button>
          {/if}
        </div>
        <ul class="dl-users">
          {#each downloads.users as u (u.username)}
            {@const visibleDirs = u.directories
              .map((d) => ({ ...d, files: d.files.filter((f) => includeFile(stateClass(f.state))) }))
              .filter((d) => d.files.length > 0)}
            {#if visibleDirs.length > 0}
              <li>
                <div class="dl-user-head">
                  <button class="user-link user-link-head" onclick={() => plexState.slskd.openPeer(u.username)}>{u.username}</button>
                  <span class="dl-user-stats">
                    {u.totalFiles} file{u.totalFiles === 1 ? '' : 's'}
                    {#if u.inProgressFiles > 0}· <span class="t-prog">{u.inProgressFiles} active</span>{/if}
                    {#if u.completedFiles > 0}· <span class="t-ok">{u.completedFiles} done</span>{/if}
                    {#if u.erroredFiles > 0}· <span class="t-err">{u.erroredFiles} errored</span>{/if}
                  </span>
                </div>
                {#each visibleDirs as d (d.directory)}
                  {@const erroredFiles = d.files.filter((f) => canRetry(stateClass(f.state)))}
                  <div class="dl-dir">
                    <div class="dl-dir-head">
                      <div class="dl-dir-name">{d.directory}</div>
                      <div class="dl-dir-actions">
                        {#if erroredFiles.length > 0}
                          <button
                            class="dir-btn"
                            title="Run a fresh Soulseek search for this album so you can grab it from a different uploader"
                            onclick={() => plexState.slskd.searchAgainForDirectory(u.username, d.directory)}
                          >⌕ search again</button>
                          <button
                            class="dir-btn"
                            title="Retry {erroredFiles.length} errored file{erroredFiles.length === 1 ? '' : 's'}"
                            onclick={() => void plexState.slskd.retryDirectory(
                              u.username,
                              erroredFiles.map((f) => ({ id: f.id, filename: f.filename, size: f.size }))
                            )}
                          >↻ retry {erroredFiles.length}</button>
                        {/if}
                        <button
                          class="dir-btn dir-remove"
                          title="Remove all {d.files.length} files in this folder"
                          onclick={() => {
                            if (confirmRemoveDir(u.username, d.files.length)) {
                              void plexState.slskd.removeDirectory(u.username, d.files.map((f) => f.id))
                            }
                          }}
                        >✕ remove all</button>
                      </div>
                    </div>
                    <ul class="dl-files">
                      {#each d.files as f (f.id)}
                        {@const cls = stateClass(f.state)}
                        <li class="dl-file" data-cls={cls}>
                          <div class="dl-line1">
                            <span class="fn">{basename(f.filename)}</span>
                            <span class="dl-state" data-cls={cls}>{stateLabel(f.state)}</span>
                            <span class="file-actions">
                              {#if canRetry(cls)}
                                <button
                                  class="file-btn"
                                  title="Retry"
                                  aria-label="Retry"
                                  onclick={() => void plexState.slskd.retryFile(u.username, f.id, f.filename, f.size)}
                                >↻</button>
                              {/if}
                              <button
                                class="file-btn file-remove"
                                title="Remove"
                                aria-label="Remove"
                                onclick={() => void plexState.slskd.removeFile(u.username, f.id)}
                              >✕</button>
                            </span>
                          </div>
                          {#if cls === 'prog' || (f.percent > 0 && cls !== 'ok')}
                            <div class="dl-bar">
                              <div class="dl-bar-fill" style="width: {Math.max(0, Math.min(100, f.percent))}%"></div>
                            </div>
                          {/if}
                          <div class="dl-line2">
                            <span>{(f.percent ?? 0).toFixed(0)}%</span>
                            <span>{fmtSize(f.bytesTransferred)} / {fmtSize(f.size)}</span>
                            {#if f.averageSpeed > 0 && cls === 'prog'}
                              <span>{fmtSpeed(f.averageSpeed)}</span>
                            {/if}
                          </div>
                        </li>
                      {/each}
                    </ul>
                  </div>
                {/each}
              </li>
            {/if}
          {/each}
        </ul>
      {/if}
    </div>
  {:else}
    <div class="uploaders">
      {#if peerBrowse}
        <div class="browse-head">
          <button class="secondary" onclick={() => plexState.slskd.closePeerBrowse()}>← uploaders</button>
          <div>
            <div class="browse-title">{peerBrowse.username}</div>
            {#if peerBrowse.result}
              <div class="browse-meta">
                {peerBrowse.result.albums.length} audio folders · {peerBrowse.result.fileCount} shared files
              </div>
            {/if}
          </div>
        </div>
        {#if peerBrowse.loading}
          <p class="hint">asking {peerBrowse.username} for their shares… this can take a minute.</p>
        {:else if peerBrowse.error}
          <p class="err">{peerBrowse.error}</p>
          <button class="secondary" onclick={() => void plexState.slskd.browsePeer(peerBrowse.username)}>try again</button>
        {:else if peerBrowse.result}
          <div class="browse-filter-row">
            <input bind:value={browseFilter} placeholder="filter artist, album, or folder" />
            <span>{visibleBrowseAlbums.length} match{visibleBrowseAlbums.length === 1 ? '' : 'es'}</span>
          </div>
          {#if visibleBrowseAlbums.length === 0}
            <p class="hint">no audio folders match that filter.</p>
          {:else}
            <ul class="browse-albums">
              {#each visibleBrowseAlbums.slice(0, 300) as album (album.folder)}
                {@const status = peerBrowse.enqueueStatus[album.folder]}
                <li>
                  <div class="browse-album-copy">
                    <div class="browse-album-name">
                      {#if album.guessedArtist}<span>{album.guessedArtist}</span><span class="c-sep">—</span>{/if}
                      <strong>{album.guessedAlbum ?? album.name}</strong>
                    </div>
                    <div class="browse-album-meta">{album.formatSummary} · {album.folder}</div>
                  </div>
                  <button
                    class="enq-btn"
                    class:done={status === 'ok'}
                    disabled={status === 'pending' || status === 'ok'}
                    onclick={() => void plexState.slskd.enqueueBrowseAlbum(album)}
                  >{status === 'pending' ? 'queueing…' : status === 'ok' ? 'queued ✓' : status === 'err' ? 'retry' : 'download'}</button>
                </li>
              {/each}
            </ul>
            {#if visibleBrowseAlbums.length > 300}
              <p class="hint">showing the first 300 folders—use the filter to narrow it down.</p>
            {/if}
          {/if}
        {/if}
      {:else}
        <form class="browse-user-form" onsubmit={browseUsername}>
          <input bind:value={manualUsername} placeholder="Soulseek username" aria-label="Soulseek username" />
          <button class="primary" type="submit" disabled={!manualUsername.trim()}>browse anyone</button>
        </form>
        {#if peersLoading && successfulPeers.length === 0}
          <p class="hint">loading successful uploaders…</p>
        {:else if peersError}
          <p class="err">{peersError}</p>
        {:else if successfulPeers.length === 0}
          <p class="hint">No successful album downloads recorded yet. They’ll appear here as downloads finish.</p>
        {:else}
          <p class="uploader-intro">People whose albums arrived successfully. Open one to browse their shared music.</p>
          <ul class="peer-list">
            {#each successfulPeers as peer (peer.username)}
              <li>
                <div>
                  <button class="user-link peer-name" onclick={() => plexState.slskd.openPeer(peer.username)}>{peer.username}</button>
                  <div class="peer-meta">
                    {peer.successfulAlbums} successful album{peer.successfulAlbums === 1 ? '' : 's'}
                    · {peer.successfulFiles} files
                    · last worked {fmtDate(peer.lastSuccessAt)}
                    {#if peer.averageSpeed > 0}· avg {fmtSpeed(peer.averageSpeed)}{/if}
                  </div>
                </div>
                <button class="secondary" onclick={() => {
                  browseFilter = ''
                  plexState.slskd.openPeer(peer.username)
                }}>browse shares →</button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .slskd {
    height: 100%;
    overflow-y: auto;
    padding: 1.25rem 1.5rem 8rem;
    box-sizing: border-box;
    color: var(--espresso);
  }
  .slskd > * { max-width: 1100px; margin-left: auto; margin-right: auto; }
  header {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    margin-bottom: 1rem;
  }
  .back {
    background: transparent;
    color: var(--espresso);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    width: 2.25rem;
    height: 2.25rem;
    font-size: 1.1rem;
    cursor: pointer;
  }
  .head { flex: 1; }
  .label { font-size: 1.4rem; letter-spacing: 0.02em; font-weight: 600; }
  .sub { color: var(--faded); font-size: 0.85rem; margin-top: 0.15rem; }
  .sub code { background: var(--inset); padding: 0.05rem 0.3rem; border-radius: var(--radius-xs); }
  .err-inline { color: var(--err-fg); font-weight: 600; }
  .retry {
    margin-left: 0.5rem;
    background: transparent;
    border: 1px solid var(--err-fg);
    color: var(--err-fg);
    font-size: 0.72rem;
    padding: 0.1rem 0.55rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
  }
  .retry:hover { background: var(--err-fg); color: var(--paper); }

  button {
    font: inherit;
    cursor: pointer;
    border-radius: var(--radius-md);
    padding: 0.45rem 0.8rem;
    border: 1px solid var(--hairline);
    background: var(--surface);
    color: var(--espresso);
  }
  button.primary { background: var(--brick); border-color: var(--brick); }
  button.primary:hover:not(:disabled) { background: var(--brick-deep); }
  button.secondary:hover:not(:disabled) { background: var(--surface-deep); }
  button:disabled { opacity: 0.55; cursor: default; }

  .config {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: 1rem;
    margin-bottom: 1rem;
    display: grid;
    gap: 0.75rem;
  }
  .config label { display: grid; gap: 0.3rem; font-size: 0.85rem; color: var(--walnut); }
  .config input {
    background: var(--paper);
    border: 1px solid var(--hairline);
    color: var(--espresso);
    padding: 0.45rem 0.6rem;
    border-radius: var(--radius-sm);
    font: inherit;
  }
  .row { display: flex; gap: 0.5rem; }

  /* Same segmented-pill language as Charts' mode switcher — one tab style
     app-wide. */
  .tabs {
    display: inline-flex;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    overflow: hidden;
    margin-bottom: 1rem;
  }
  .tab {
    background: transparent;
    border: 0;
    color: var(--walnut);
    padding: 0.4rem 1rem;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .tab:hover { color: var(--espresso); }
  .tab.active {
    background: var(--brick);
    color: var(--paper);
  }
  .tab-count {
    margin-left: 0.35rem;
    font-size: 0.75rem;
    color: var(--ok-fg);
  }
  .tab.active .tab-count { color: var(--paper); }

  .uploaders { display: grid; gap: 0.85rem; }
  .uploader-intro, .browse-meta, .peer-meta, .browse-album-meta {
    color: var(--faded);
    font-size: 0.8rem;
  }
  .peer-list, .browse-albums { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.55rem; }
  .peer-list > li, .browse-albums > li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 0.9rem;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--paper);
  }
  .peer-name, .browse-title { font-size: 1rem; font-weight: 650; }
  .peer-meta, .browse-album-meta { margin-top: 0.2rem; }
  .browse-head { display: flex; align-items: center; gap: 0.8rem; }
  .browse-filter-row { display: flex; align-items: center; gap: 0.75rem; }
  .browse-filter-row input {
    flex: 1;
    background: var(--paper);
    border: 1px solid var(--hairline);
    color: var(--espresso);
    padding: 0.55rem 0.7rem;
    border-radius: var(--radius-md);
    font: inherit;
  }
  .browse-user-form { display: flex; gap: 0.5rem; }
  .browse-user-form input {
    flex: 1;
    background: var(--paper);
    border: 1px solid var(--hairline);
    color: var(--espresso);
    padding: 0.55rem 0.7rem;
    border-radius: var(--radius-md);
    font: inherit;
  }
  .browse-filter-row span { color: var(--faded); font-size: 0.8rem; white-space: nowrap; }
  .browse-album-copy { min-width: 0; }
  .browse-album-name { display: flex; gap: 0.3rem; align-items: baseline; }
  .browse-album-meta { overflow-wrap: anywhere; }

  .downloads { display: grid; gap: 0.85rem; }
  .acquisitions {
    display: grid;
    gap: 0.4rem;
    background: var(--paper);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: 0.75rem 0.85rem;
  }
  .acq-heading {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    color: var(--faded);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .acq-heading:hover { color: var(--ink); }
  .acq-caret { transition: transform 0.15s ease; display: inline-block; }
  .acq-caret.collapsed { transform: rotate(-90deg); }
  .acq-count {
    color: var(--faded);
    font: 0.72rem var(--font-mono);
    letter-spacing: 0;
  }
  .acq-job { border-left: 3px solid var(--hairline); padding: 0.35rem 0.6rem; background: var(--surface); }
  .acq-job[data-status='completed'] { border-left-color: var(--ok-fg); }
  .acq-job[data-status='partial'], .acq-job[data-status='failed'] { border-left-color: var(--err-fg); }
  .acq-job[data-status='downloading'], .acq-job[data-status='downloaded'] { border-left-color: var(--brick); }
  .acq-main { display: flex; align-items: baseline; gap: 0.25rem; font-size: 0.9rem; }
  .acq-artist { font-weight: 600; }
  .acq-status { margin-left: auto; color: var(--faded); font: 0.72rem var(--font-mono); }
  .acq-meta, .acq-error { color: var(--faded); font-size: 0.72rem; margin-top: 0.15rem; }
  .acq-error { color: var(--err-fg); }
  .dl-totals {
    display: flex;
    gap: 0.4rem;
    color: var(--faded);
    font-size: 0.85rem;
    padding: 0.25rem 0;
    flex-wrap: wrap;
  }
  .chip {
    background: var(--surface);
    border: 1px solid var(--hairline);
    color: inherit;
    padding: 0.3rem 0.7rem;
    border-radius: var(--radius-pill);
    font-size: 0.82rem;
    cursor: pointer;
  }
  .chip:hover { background: var(--surface-deep); }
  .chip.active {
    background: var(--brick);
    border-color: var(--brick);
    color: #fff;
  }
  .chip.active.t-prog,
  .chip.active.t-q,
  .chip.active.t-ok,
  .chip.active.t-err { color: #fff; }
  .chip.active.t-ok { background: var(--ok-bg); border-color: var(--ok-bg); }
  .chip.active.t-err { background: var(--warn-bg); border-color: var(--warn-bg); }
  .chip.clear-done { margin-left: auto; color: var(--faded); }
  .chip.clear-done:hover:not(:disabled) { color: var(--brick); border-color: var(--brick); }
  .chip.clear-done:disabled { opacity: 0.6; cursor: default; }
  .chip.active.t-q { background: var(--ink-tint-12); border-color: var(--ink-tint-12); }
  .t-prog { color: var(--ok-fg); }
  .t-q { color: var(--walnut); }
  .t-ok { color: var(--ok-fg); }
  .t-err { color: var(--err-fg); }

  .dl-users { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.8rem; }
  .dl-users > li {
    background: var(--paper);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: 0.65rem 0.85rem;
  }
  .dl-user-head {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.4rem;
  }
  .dl-user-stats { color: var(--faded); font-size: 0.8rem; }

  .dl-dir { margin-top: 0.5rem; }
  .dl-dir-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-bottom: 0.25rem;
    border-bottom: 1px dashed var(--hairline);
    margin-bottom: 0.3rem;
  }
  .dl-dir-name {
    flex: 1;
    color: var(--faded);
    font-size: 0.78rem;
    word-break: break-all;
  }
  .dl-dir-actions {
    display: flex;
    gap: 0.3rem;
    flex-shrink: 0;
  }
  .dir-btn {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--faded);
    font-size: 0.72rem;
    padding: 0.15rem 0.5rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
    white-space: nowrap;
  }
  .dir-btn:hover { background: var(--surface-deep); color: var(--espresso); }
  .dir-remove:hover { border-color: var(--warn-border); color: var(--err-fg); }
  .dl-files { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.35rem; }
  .dl-file {
    display: grid;
    gap: 0.15rem;
    padding: 0.3rem 0.4rem;
    border-radius: var(--radius-sm);
    background: var(--surface);
    border: 1px solid transparent;
  }
  .dl-file[data-cls='prog'] { border-color: var(--ok-border); }
  .dl-file[data-cls='ok'] { border-color: var(--ok-bg); opacity: 0.7; }
  .dl-file[data-cls='err'] { border-color: var(--warn-border); }
  .dl-file[data-cls='x'] { opacity: 0.55; }

  .dl-line1 {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    font-size: 0.85rem;
  }
  .file-actions {
    display: flex;
    gap: 0.2rem;
    margin-left: auto;
    opacity: 0.4;
    transition: opacity 120ms;
  }
  .dl-file:hover .file-actions { opacity: 1; }
  .file-btn {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--faded);
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    line-height: 1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .file-btn:hover { background: var(--surface-deep); color: var(--espresso); }
  .file-remove:hover { border-color: var(--warn-border); color: var(--err-fg); }
  .dl-state {
    font-size: 0.75rem;
    font-family: var(--font-mono);
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-xs);
    background: var(--surface-deep);
    color: var(--faded);
    white-space: nowrap;
  }
  .dl-state[data-cls='prog'] { color: var(--ok-fg); background: var(--ink-tint-08); }
  .dl-state[data-cls='ok'] { color: var(--ok-fg); background: var(--ok-bg); }
  .dl-state[data-cls='err'] { color: var(--err-fg); background: var(--warn-bg); }
  .dl-state[data-cls='q'] { color: var(--walnut); }

  .dl-bar {
    height: 3px;
    background: var(--hairline);
    border-radius: var(--radius-xs);
    overflow: hidden;
  }
  .dl-bar-fill {
    height: 100%;
    background: var(--brick);
    transition: width 250ms linear;
  }
  .dl-file[data-cls='ok'] .dl-bar-fill { background: var(--ok-fg); }
  .dl-file[data-cls='err'] .dl-bar-fill { background: var(--err-fg); }

  .dl-line2 {
    display: flex;
    gap: 0.75rem;
    color: var(--faded);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .inputs { display: grid; gap: 0.75rem; margin-bottom: 1rem; }
  .manual { display: flex; gap: 0.5rem; align-items: center; }
  .manual input {
    background: var(--paper);
    border: 1px solid var(--hairline);
    color: var(--espresso);
    padding: 0.55rem 0.75rem;
    border-radius: var(--radius-md);
    font: inherit;
    flex: 1;
  }
  .f-artist { max-width: 240px; }

  .bulk {
    background: var(--paper);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: 0.65rem 0.9rem;
  }
  .bulk summary {
    cursor: pointer;
    color: var(--faded);
    font-size: 0.85rem;
    user-select: none;
    padding: 0.1rem 0;
  }
  .bulk textarea {
    margin-top: 0.6rem;
    width: 100%;
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--hairline);
    color: var(--espresso);
    padding: 0.55rem 0.7rem;
    border-radius: var(--radius-sm);
    font: inherit;
    resize: vertical;
  }

  .queue {
    background: var(--paper);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: 0.65rem 0.9rem;
    margin-bottom: 1rem;
    max-height: 220px;
    overflow-y: auto;
  }
  .q-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--faded);
    font-size: 0.85rem;
    margin-bottom: 0.4rem;
  }
  .q-header button { margin-left: auto; padding: 0.25rem 0.55rem; }
  .q-search-prog {
    font-size: 0.75rem;
    color: var(--faded);
    font-variant-numeric: tabular-nums;
  }
  .q-search-active { color: var(--ok-fg); }
  .q-list { list-style: none; padding: 0; margin: 0; }
  .q-list li { margin: 0; }
  .q-item {
    display: grid;
    grid-template-columns: 2.2rem 1fr auto 1fr 3rem;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: 0.25rem 0.4rem;
    color: inherit;
    border-radius: var(--radius-sm);
    align-items: baseline;
  }
  .q-item:hover { background: var(--surface); }
  .q-list li.active .q-item { background: var(--brick-wash); color: var(--espresso); }
  .q-list li.done .q-item { opacity: 0.5; }
  .q-num { color: var(--faded); font-size: 0.8rem; font-variant-numeric: tabular-nums; }
  .q-sep { color: var(--faded); }
  .q-artist { color: var(--espresso); }
  .q-album { color: var(--walnut); }
  .q-status[data-status='enqueued'] { color: var(--ok-fg); text-align: right; }

  .current {
    background: var(--paper);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: 1rem;
  }
  .c-header { margin-bottom: 0.75rem; }
  .c-title { font-size: 1.05rem; }
  .c-sep { color: var(--faded); margin: 0 0.4rem; }
  .c-album { color: var(--walnut); }
  .c-meta { color: var(--faded); font-size: 0.8rem; margin-top: 0.25rem; }

  .hint { color: var(--faded); font-style: italic; }
  .err { color: var(--err-fg); }

  .albums { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.65rem; }
  .albums > li {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: 0.75rem 0.95rem;
    transition: opacity 150ms, border-color 150ms;
  }
  .albums > li.enq { border-color: var(--ok-border); }
  .albums > li.busy { opacity: 0.75; }
  .albums > li.complete { border-color: var(--ok-border); background: var(--ok-bg); }
  .albums > li.partial { border-color: var(--brick); }

  .badge {
    display: inline-block;
    margin-left: 0.5rem;
    padding: 0.08rem 0.42rem;
    border-radius: var(--radius-pill);
    font-size: 0.7rem;
    font-weight: 500;
    vertical-align: middle;
  }
  .badge-ok { background: var(--ok-bg); color: var(--ok-fg); border: 1px solid var(--ok-border); }
  .badge-warn { background: var(--brick-wash); color: var(--brick-deep); border: 1px solid var(--brick); }

  /* "already in your library" tells */
  .owned-tell {
    display: inline-block;
    margin-left: 0.6rem;
    padding: 0.1rem 0.5rem;
    border-radius: var(--radius-pill);
    font-size: 0.72rem;
    font-weight: 500;
    vertical-align: middle;
    background: var(--ok-bg);
    color: var(--ok-fg);
    border: 1px solid var(--ok-border);
  }
  .q-owned {
    margin-left: 0.4rem;
    font-size: 0.7rem;
    color: var(--ok-fg);
    white-space: nowrap;
  }
  .q-list li.owned .q-item { background: var(--ok-bg); }
  .q-list li.owned.active .q-item { background: var(--brick-wash); }

  .c-mb {
    color: var(--ok-fg);
    font-size: 0.8rem;
    margin-top: 0.2rem;
  }
  .c-mb-miss { color: var(--faded); font-style: italic; }
  .mb-label { color: var(--faded); margin-right: 0.25rem; }
  .mb-switch {
    margin-left: 0.5rem;
    background: transparent;
    border: 1px solid var(--hairline);
    color: inherit;
    font: inherit;
    font-size: 0.72rem;
    padding: 0.1rem 0.45rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
    opacity: 0.8;
  }
  .mb-switch:hover { opacity: 1; border-color: var(--brick); color: var(--brick); }
  .red-link,
  .lossy-link {
    background: transparent;
    border: 1px solid var(--hairline);
    color: inherit;
    font: inherit;
    font-size: 0.78rem;
    padding: 0.1rem 0.5rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
  }
  .red-link { border-color: var(--brick); color: var(--brick); }
  .red-link:hover { background: var(--warn-bg); }
  .lossy-link { margin-left: 0.6rem; color: var(--faded); }
  .lossy-link:hover { border-color: var(--hairline); color: var(--brick); }
  .result-fallback {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.5rem;
    margin: -0.15rem 0 0.65rem;
    color: var(--faded);
    font-size: 0.78rem;
  }

  .alb-head {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    flex-wrap: wrap;
  }
  .alb-title { flex: 1; min-width: 0; font-size: 1rem; line-height: 1.3; }
  .alb-artist { color: var(--espresso); font-weight: 500; }
  .alb-sep { color: var(--faded); margin: 0 0.4rem; }
  .alb-name { color: var(--walnut); }

  .alb-source {
    color: var(--faded);
    font-size: 0.8rem;
    margin-top: 0.35rem;
  }
  .user-link {
    display: inline;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--ok-fg);
    font: inherit;
    font-weight: 550;
    text-decoration: underline;
    text-decoration-color: transparent;
    text-underline-offset: 0.15em;
  }
  .user-link:hover { text-decoration-color: currentColor; }
  .user-link-head { font-size: 1rem; }
  .slot-ok { color: var(--ok-fg); }
  .slot-failed { color: var(--err-fg); font-weight: 600; }
  .slot-busy { color: var(--brick-deep); }
  .slot-mine { color: var(--brick); font-weight: 600; }

  .enq-btn {
    padding: 0.5rem 1rem;
    background: var(--brick);
    border-color: var(--brick);
    font-size: 0.9rem;
    white-space: nowrap;
  }
  .enq-btn:hover:not(:disabled) { background: var(--brick-deep); }
  .enq-btn.done {
    background: var(--ok-bg);
    border-color: var(--ok-bg);
  }

  .alb-files,
  .alb-alts {
    margin-top: 0.55rem;
  }
  .alb-files summary,
  .alb-alts summary {
    cursor: pointer;
    color: var(--faded);
    font-size: 0.8rem;
    user-select: none;
  }
  .alb-files ul,
  .alb-alts ul {
    list-style: none;
    padding: 0.4rem 0 0;
    margin: 0;
    font-size: 0.8rem;
    display: grid;
    gap: 0.22rem;
  }
  .alb-files li {
    display: flex;
    gap: 0.6rem;
    color: var(--walnut);
  }
  .fn { flex: 1; word-break: break-all; }
  .fm { color: var(--faded); white-space: nowrap; }
  .file-dl {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    color: var(--faded);
    font-size: 0.75rem;
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .alb-files li:hover .file-dl { opacity: 1; }
  .file-dl.done { opacity: 1; color: var(--brick); border-color: var(--brick); cursor: default; }
  .file-dl:hover:not(:disabled) { color: var(--brick); border-color: var(--brick); }
  .file-dl:disabled { cursor: default; }

  .alt-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    flex-wrap: wrap;
  }
  .alb-folder { color: var(--faded); flex: 1; min-width: 0; word-break: break-all; }
  .alb-meta { color: var(--faded); font-size: 0.78rem; }
  .alt-btn {
    padding: 0.28rem 0.6rem;
    font-size: 0.8rem;
    background: var(--surface-deep);
  }
  .alt-btn:hover:not(:disabled) { background: var(--hairline); }
  .alt-btn.done {
    background: var(--ok-bg);
    border-color: var(--ok-bg);
  }
</style>
