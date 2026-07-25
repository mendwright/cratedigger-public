<script lang="ts">
  import type { ReleaseRadarRow } from '../../../shared/plex'
  import { plexState } from '../lib/plex-state.svelte'
  import { fmtMbDate } from '../lib/format'
  import BackButton from '../lib/BackButton.svelte'

  const snap = $derived(plexState.releaseRadar)
  const prog = $derived(plexState.releaseRadarProgress)
  const isRunning = $derived(!!prog?.running)
  const hasEverRun = $derived(!!snap?.builtAt)

  // Belt-and-suspenders dedupe — the main-process bucketer also dedupes, but
  // snapshots persisted by older builds can still carry collab-induced
  // duplicates (same release-group MBID under both artists of a collab).
  // Without this guard the {#each} validator throws and the whole page
  // refuses to render.
  function dedupe(rows: ReleaseRadarRow[]): ReleaseRadarRow[] {
    const seen = new Set<string>()
    const out: ReleaseRadarRow[] = []
    for (const r of rows) {
      if (seen.has(r.releaseGroupMbid)) continue
      seen.add(r.releaseGroupMbid)
      out.push(r)
    }
    return out
  }
  const upcoming = $derived(snap ? dedupe(snap.upcoming) : [])
  const recent = $derived(snap ? dedupe(snap.recent) : [])

  function fmtBuiltAt(ts: number | null | undefined): string {
    if (!ts) return ''
    const d = new Date(ts)
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  }

  function progressLabel(): string {
    if (!prog) return ''
    if (prog.phase === 'enumerating') return 'Enumerating library artists…'
    if (prog.phase === 'fetching' && prog.total > 0) {
      return `Fetching MusicBrainz: ${prog.done} / ${prog.total} artists`
    }
    return ''
  }

  function openArtist(row: ReleaseRadarRow): void {
    void plexState.openEntity(row.artistMbid, row.artistName)
  }
</script>

<div class="page">
  <header class="head">
    <div class="title-row">
      <BackButton onclick={() => plexState.closeNewReleases()} />
      <div>
        <h1>New &amp; Upcoming</h1>
        {#if snap?.builtAt}
          <div class="sub">Last refreshed {fmtBuiltAt(snap.builtAt)}</div>
        {/if}
      </div>
    </div>
    <div class="actions">
      {#if isRunning}
        <button class="secondary" onclick={() => void plexState.cancelReleaseRadar()}>
          Stop
        </button>
      {:else if hasEverRun}
        <button class="primary" onclick={() => void plexState.refreshReleaseRadar()}>
          Refresh
        </button>
      {/if}
    </div>
  </header>

  {#if isRunning}
    <div class="progress">
      <div class="bar">
        {#if prog && prog.total > 0}
          <div class="fill" style="width: {Math.min(100, (prog.done / prog.total) * 100)}%"></div>
        {/if}
      </div>
      <div class="prog-text">
        <span>{progressLabel()}</span>
        {#if prog?.currentArtist}<span class="current">· {prog.currentArtist}</span>{/if}
      </div>
      {#if prog?.lastError}
        <div class="err-note">last error: {prog.lastError}</div>
      {/if}
    </div>
  {/if}

  {#if !hasEverRun && !isRunning}
    <div class="empty">
      <p><strong>Build the radar.</strong></p>
      <p class="hint">
        Cratedigger will walk every artist in your library with a MusicBrainz ID and ask
        MB which release-groups they have. This takes a while the first time (MB allows
        about one request per second) — but subsequent refreshes only re-fetch artists
        whose cached data is older than a week.
      </p>
      <button class="primary cta" onclick={() => void plexState.refreshReleaseRadar()}>
        Build now
      </button>
    </div>
  {:else if snap}
    {#if upcoming.length > 0}
      <section>
        <h2>Coming soon <span class="count">{upcoming.length}</span></h2>
        <ul class="rows">
          {#each upcoming as r (r.releaseGroupMbid)}
            <li>
              <button class="row" onclick={() => openArtist(r)}>
                <span class="date">{fmtMbDate(r.firstReleaseDate)}</span>
                <span class="artist">{r.artistName}</span>
                <span class="title">{r.title}</span>
                {#if r.primaryType}<span class="kind">{r.primaryType}</span>{/if}
              </button>
              <a
                class="mb-link"
                href={`https://musicbrainz.org/release-group/${r.releaseGroupMbid}`}
                target="_blank"
                rel="noreferrer"
                title="Open on MusicBrainz"
              >↗</a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if recent.length > 0}
      <section>
        <h2>Just released <span class="count">{recent.length}</span></h2>
        <ul class="rows">
          {#each recent as r (r.releaseGroupMbid)}
            <li>
              <button class="row" onclick={() => openArtist(r)}>
                <span class="date">{fmtMbDate(r.firstReleaseDate)}</span>
                <span class="artist">{r.artistName}</span>
                <span class="title">{r.title}</span>
                {#if r.primaryType}<span class="kind">{r.primaryType}</span>{/if}
              </button>
              <a
                class="mb-link"
                href={`https://musicbrainz.org/release-group/${r.releaseGroupMbid}`}
                target="_blank"
                rel="noreferrer"
                title="Open on MusicBrainz"
              >↗</a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if upcoming.length === 0 && recent.length === 0 && !isRunning}
      <div class="empty">
        <p><strong>Nothing new — yet.</strong></p>
        <p class="hint">
          No releases in the last 60 days or announced for the next year for any of your
          library artists with MusicBrainz IDs. Try refreshing in a few weeks.
        </p>
      </div>
    {/if}
  {/if}
</div>

<style>
  .page {
    height: 100%;
    overflow-y: auto;
    padding: 1.5rem 2rem 4rem;
    box-sizing: border-box;
  }
  .page > * {
    max-width: 1100px;
    margin-left: auto;
    margin-right: auto;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  h1 {
    display: inline;
    font-size: 1.4rem;
    font-weight: 600;
    margin: 0;
  }
  .sub {
    color: var(--faded);
    font-size: 0.8rem;
    margin-top: 0.15rem;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  .primary {
    background: var(--brick);
    color: var(--inset);
    border: 0;
    padding: 0.45rem 1rem;
    border-radius: var(--radius-pill);
    font-weight: 600;
    cursor: pointer;
  }
  .primary.cta {
    margin-top: 1.1rem;
    padding: 0.55rem 1.4rem;
  }
  .secondary {
    background: transparent;
    color: var(--walnut);
    border: 1px solid var(--hairline);
    padding: 0.4rem 0.85rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
  }
  .secondary:hover {
    border-color: var(--brick);
    color: var(--brick);
  }

  .progress {
    margin-bottom: 1.5rem;
    padding: 0.75rem 1rem;
    background: var(--paper);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
  }
  .bar {
    height: 4px;
    background: var(--hairline);
    border-radius: var(--radius-xs);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--brick);
    transition: width 200ms ease-out;
  }
  .prog-text {
    margin-top: 0.5rem;
    font-size: 0.82rem;
    color: var(--faded);
  }
  .prog-text .current {
    color: var(--walnut);
    margin-left: 0.3rem;
  }
  .err-note {
    margin-top: 0.4rem;
    font-size: 0.75rem;
    color: var(--err-fg);
  }

  .empty {
    padding: 3rem 1rem;
    text-align: center;
    color: var(--faded);
  }
  .empty .hint {
    max-width: 540px;
    margin: 0.5rem auto 0;
    font-size: 0.88rem;
    line-height: 1.45;
  }

  section {
    margin-bottom: 2rem;
  }
  h2 {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--faded);
    font-weight: 600;
    margin: 0 0 0.5rem;
  }
  .count {
    color: var(--whisper);
    margin-left: 0.4rem;
    font-weight: 400;
  }
  .rows {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .rows li {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--hairline);
  }
  .row {
    flex: 1;
    text-align: left;
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    padding: 0.55rem 0.5rem;
    display: grid;
    grid-template-columns: 7rem 1fr 2fr auto;
    gap: 1rem;
    align-items: baseline;
    font: inherit;
  }
  .row:hover {
    background: var(--hairline);
  }
  .date {
    color: var(--faded);
    font-size: 0.82rem;
    font-variant-numeric: tabular-nums;
  }
  .artist {
    font-weight: 600;
    font-size: 0.92rem;
  }
  .title {
    font-size: 0.92rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kind {
    color: var(--faded);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .mb-link {
    align-self: center;
    color: var(--faded);
    text-decoration: none;
    padding: 0 0.75rem;
    font-size: 0.85rem;
  }
  .mb-link:hover {
    color: var(--brick);
  }
</style>
