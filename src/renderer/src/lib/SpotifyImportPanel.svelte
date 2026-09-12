<script lang="ts">
  import { plexState } from './plex-state.svelte'
  import { PUBLIC_BUILD } from '../../../shared/build-flags'
  import type { SpotifyImportReport } from '../../../shared/spotify'

  const ctl = $derived(plexState.spotifyImport)

  let clientIdDraft = $state('')
  let openReportId = $state<string | null>(null)
  let fileInput = $state<HTMLInputElement | null>(null)
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

  let fileFilter = $state('')
  const visibleFilePlaylists = $derived.by(() => {
    const q = fileFilter.trim().toLowerCase()
    if (!q) return ctl.filePlaylists
    return ctl.filePlaylists.filter((p) => p.name.toLowerCase().includes(q))
  })

  async function onFilesPicked(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement
    for (const f of input.files ?? []) {
      ctl.addFile(await f.text(), f.name)
    }
    input.value = ''
  }

  const openReport = $derived(
    openReportId ? (ctl.reports.find((r) => r.playlistId === openReportId) ?? null) : null
  )

  function fmtWhen(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  function reportLine(r: SpotifyImportReport): string {
    return r.gaps.length === 0
      ? `${r.matchedCount}/${r.total} · complete`
      : `${r.matchedCount}/${r.total} · ${r.gaps.length} gap${r.gaps.length === 1 ? '' : 's'}`
  }
</script>

<div class="sp">
  <input
    type="file"
    accept=".csv,.json"
    multiple
    bind:this={fileInput}
    onchange={onFilesPicked}
    style="display: none"
  />

  {#if isMac}
    <div class="file-row">
      <button class="secondary" disabled={ctl.appleLoading} onclick={() => void ctl.loadApplePlaylists()}>
        {ctl.appleLoading ? 'reading Music.app…' : 'read Music.app playlists'}
      </button>
      <span class="hint">Apple Music playlists synced to this Mac</span>
    </div>
    {#if ctl.appleError}<p class="err">{ctl.appleError}</p>{/if}
    {#if ctl.applePlaylists.length > 0}
      <ul class="sp-list">
        {#each ctl.applePlaylists as pl (pl.id)}
          {@const report = ctl.reportFor(`apple:${pl.id}`)}
          <li>
            <div class="sp-meta">
              <div class="sp-title">{pl.name}</div>
              <div class="sp-sub">
                {pl.trackCount} track{pl.trackCount === 1 ? '' : 's'} · Music.app
                {#if report}
                  · <button class="linkish inline" onclick={() => (openReportId = `apple:${pl.id}`)}>{reportLine(report)}</button>
                {/if}
              </div>
            </div>
            <button
              class="sp-import"
              disabled={ctl.progress !== null}
              onclick={() => void ctl.importFromApple(pl)}
            >
              {report ? 're-import' : 'import'}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  <div class="file-row">
    <button class="secondary" onclick={() => void ctl.pickImportFolder()}>
      {ctl.importDir ? 'change export folder…' : 'choose export folder…'}
    </button>
    <button class="secondary" onclick={() => fileInput?.click()}>single file…</button>
    <span class="hint">
      {#if ctl.importDir}
        reading {ctl.importDir.split('/').pop()} — remembered across restarts
      {:else}
        Exportify CSVs or Spotify data-export JSON
      {/if}
    </span>
  </div>

  {#if ctl.filePlaylists.length > 15}
    <input class="pl-filter" type="text" placeholder="filter {ctl.filePlaylists.length} playlists…" bind:value={fileFilter} />
  {/if}
  {#if ctl.filePlaylists.length > 0}
    <ul class="sp-list">
      {#each visibleFilePlaylists as pl (pl.name)}
        {@const report = ctl.reportFor(`file:${pl.name}`)}
        <li>
          <div class="sp-meta">
            <div class="sp-title">{pl.name}</div>
            <div class="sp-sub">
              {pl.tracks.length} track{pl.tracks.length === 1 ? '' : 's'} · from file
              {#if report}
                · <button class="linkish inline" onclick={() => (openReportId = `file:${pl.name}`)}>{reportLine(report)}</button>
              {/if}
            </div>
          </div>
          <button
            class="sp-import"
            disabled={ctl.progress !== null}
            onclick={() => void ctl.importFromFile(pl)}
          >
            {report ? 're-import' : 'import'}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if ctl.progress}
    {@const p = ctl.progress}
    <div class="prog">
      <div class="prog-label">importing “{p.name}” — {p.done}/{p.total}</div>
      <div class="prog-rail"><div class="prog-fill" style="width: {p.total ? (p.done / p.total) * 100 : 0}%"></div></div>
    </div>
  {/if}

  {#if ctl.reports.length > 0 && !openReport}
    <div class="rep-list-head">imports</div>
    <ul class="sp-list">
      {#each ctl.reports as r (r.playlistId)}
        <li>
          <div class="sp-meta">
            <div class="sp-title">{r.name}</div>
            <div class="sp-sub">{fmtWhen(r.importedAt)} · {reportLine(r)}</div>
          </div>
          <button class="sp-import" onclick={() => (openReportId = r.playlistId)}>gaps</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if !ctl.status.configured && !openReport}
    <div class="setup">
      <p class="lead api-note">
        Live account sync is also possible, but Spotify now requires a Premium
        subscription to register the needed API app — the file route above works
        on any account: export at <span class="mono">exportify.net</span>, or request
        your data at <span class="mono">spotify.com/account/privacy</span>.
      </p>
      <details>
        <summary>set up live sync anyway (needs Premium)</summary>
        <ol>
          <li>Open <span class="mono">developer.spotify.com/dashboard</span> and create an app.</li>
          <li>Add this exact Redirect URI: <span class="mono">http://127.0.0.1:48219/callback</span></li>
          <li>Paste the app's <strong>Client ID</strong>:</li>
        </ol>
        <form
          class="cid"
          onsubmit={(e) => {
            e.preventDefault()
            if (clientIdDraft.trim()) void ctl.setClientId(clientIdDraft)
          }}
        >
          <input type="text" placeholder="spotify client id" bind:value={clientIdDraft} />
          <button type="submit" class="primary" disabled={!clientIdDraft.trim()}>save</button>
        </form>
      </details>
    </div>
  {:else if !ctl.status.connected && !openReport}
    <div class="setup">
      <p class="lead">Client ID saved. Connecting opens Spotify in your browser to approve read-only playlist access.</p>
      <button class="primary" disabled={ctl.connecting} onclick={() => void ctl.connect()}>
        {ctl.connecting ? 'waiting for spotify…' : 'connect spotify'}
      </button>
      {#if ctl.error}<p class="err">{ctl.error}</p>{/if}
    </div>
  {:else if openReport}
    <div class="report">
      <div class="rep-head">
        <button class="linkish" onclick={() => (openReportId = null)}>← imports</button>
        <div class="rep-title">{openReport.name}</div>
        <div class="rep-sub">
          imported {fmtWhen(openReport.importedAt)} · {openReport.matchedCount}/{openReport.total} matched
        </div>
      </div>
      {#if openReport.gaps.length === 0}
        <p class="hint">no gaps — the whole playlist is in the library.</p>
      {:else}
        <p class="hint">{openReport.gaps.length} track{openReport.gaps.length === 1 ? '' : 's'} not in the library:</p>
        <ul class="gaps">
          {#each openReport.gaps as g, i (i)}
            <li>
              <div class="gap-meta">
                <div class="gap-title">{g.title}</div>
                <div class="gap-sub">{g.artist}{g.album ? ` · ${g.album}` : ''}</div>
              </div>
              {#if !PUBLIC_BUILD}
                <button
                  class="gap-find"
                  onclick={() => void plexState.findGapAlbumOnSlskd(g.artist, g.title, g.album || null)}
                  title="Search Soulseek for the full LP this song is on (resolves singles via MusicBrainz)"
                >
                  album
                </button>
                <button
                  class="gap-find quiet"
                  onclick={() => void plexState.findGapOnSlskd(g.artist, g.title)}
                  title="Search Soulseek for just this track — use ↓ on a file in the results"
                >
                  song
                </button>
                <button
                  class="gap-find red"
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
  {:else}
    <div class="browse">
      <div class="browse-head">
        <span class="hint">connected · read-only</span>
        <button class="linkish" onclick={() => void ctl.loadPlaylists()} disabled={ctl.playlistsLoading}>refresh</button>
        <button class="linkish" onclick={() => void ctl.disconnect()}>disconnect</button>
      </div>
      {#if ctl.error}<p class="err">{ctl.error}</p>{/if}
      {#if ctl.playlistsLoading && ctl.playlists.length === 0}
        <p class="hint">loading your playlists…</p>
      {/if}
      <ul class="sp-list">
        {#each ctl.playlists as p (p.id)}
          {@const report = ctl.reportFor(p.id)}
          <li>
            <div class="sp-meta">
              <div class="sp-title">{p.name}</div>
              <div class="sp-sub">
                {p.trackCount} track{p.trackCount === 1 ? '' : 's'}{p.owner ? ` · ${p.owner}` : ''}
                {#if report}
                  · <button class="linkish inline" onclick={() => (openReportId = p.id)}>{reportLine(report)}</button>
                {/if}
              </div>
            </div>
            <button
              class="sp-import"
              disabled={ctl.progress !== null}
              onclick={() => void ctl.importPlaylist(p)}
              title={report ? 'Re-import — refills the Plex playlist and re-checks gaps' : 'Match against the library and create the Plex playlist'}
            >
              {report ? 're-import' : 'import'}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .sp { display: flex; flex-direction: column; gap: 0.7rem; overflow-y: auto; min-height: 0; }
  .lead { margin: 0; font-size: 0.9rem; }
  .file-row { display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; }
  .pl-filter {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: 0.4rem 0.65rem;
    font: inherit;
    color: inherit;
    max-width: 320px;
  }
  .secondary {
    font: inherit;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    color: var(--espresso);
    padding: 0.4rem 0.9rem;
    cursor: pointer;
  }
  .secondary:hover { border-color: var(--brick); color: var(--brick); }
  .rep-list-head {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--faded);
    margin-top: 0.4rem;
  }
  .api-note { color: var(--faded); }
  details { font-size: 0.85rem; }
  details summary { cursor: pointer; color: var(--faded); }
  details[open] summary { margin-bottom: 0.4rem; }
  .setup ol { margin: 0.3rem 0; padding-left: 1.3rem; font-size: 0.85rem; line-height: 1.7; }
  .mono {
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: 0.05rem 0.35rem;
    user-select: all;
  }
  .cid { display: flex; gap: 0.45rem; max-width: 480px; }
  .cid input {
    flex: 1;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: 0.45rem 0.65rem;
    font: inherit;
    color: inherit;
  }
  .err { color: var(--warn-fg); font-size: 0.85rem; margin: 0; }
  .hint { color: var(--faded); font-size: 0.85rem; margin: 0; }
  .browse-head { display: flex; gap: 0.9rem; align-items: baseline; }
  .linkish {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    font-size: 0.82rem;
    color: var(--brick);
    cursor: pointer;
  }
  .linkish:hover { text-decoration: underline; }
  .linkish:disabled { opacity: 0.5; cursor: default; }
  .linkish.inline { font-size: inherit; }
  .prog { display: flex; flex-direction: column; gap: 0.3rem; }
  .prog-label { font-size: 0.82rem; color: var(--faded); }
  .prog-rail { height: 4px; background: var(--hairline); border-radius: var(--radius-pill); overflow: hidden; }
  .prog-fill { height: 100%; background: var(--brick); transition: width 300ms ease; }
  .sp-list, .gaps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .sp-list li, .gaps li {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.45rem 0.2rem;
    border-bottom: 1px solid var(--surface);
    min-width: 0;
  }
  .sp-meta, .gap-meta { flex: 1; min-width: 0; }
  .sp-title, .gap-title { font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sp-sub, .gap-sub { font-size: 0.75rem; color: var(--faded); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sp-import, .gap-find {
    flex-shrink: 0;
    font: inherit;
    font-size: 0.8rem;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    color: var(--espresso);
    padding: 0.25rem 0.7rem;
    cursor: pointer;
  }
  .sp-import:hover:not(:disabled), .gap-find:hover { border-color: var(--brick); color: var(--brick); }
  .gap-find.quiet { border-color: transparent; color: var(--faded); }
  .gap-find.quiet:hover { border-color: var(--hairline); color: var(--brick); }
  .gap-find.red { border-color: transparent; color: var(--faded); letter-spacing: 0.04em; }
  .gap-find.red:hover { border-color: var(--hairline); color: var(--brick); }
  .sp-import:disabled { opacity: 0.5; cursor: default; }
  .rep-head { display: flex; flex-direction: column; gap: 0.15rem; }
  .rep-title { font-size: 1.05rem; font-weight: 650; }
  .rep-sub { font-size: 0.78rem; color: var(--faded); }
  .primary {
    font: inherit;
    background: var(--espresso);
    color: var(--paper);
    border: 1px solid var(--espresso);
    border-radius: var(--radius-pill);
    padding: 0.4rem 0.9rem;
    cursor: pointer;
    align-self: flex-start;
  }
  .primary:hover:not(:disabled) { background: var(--brick); border-color: var(--brick); }
  .primary:disabled { opacity: 0.5; cursor: default; }
</style>
