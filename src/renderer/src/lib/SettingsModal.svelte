<script lang="ts">
  import { plexState } from './plex-state.svelte'
  import { PUBLIC_BUILD } from '../../../shared/build-flags'

  let draftLastfm = $state('')
  let draftTagger = $state('')
  let draftTicketmaster = $state('')
  let draftGeniusId = $state('')
  let draftGeniusSecret = $state('')
  let draftAdminToken = $state('')
  let draftBijouUrl = $state('')
  let draftSlskdUrl = $state('')
  let draftSlskdKey = $state('')
  let draftTautulliUrl = $state('')
  let draftTautulliKey = $state('')
  let tautulliBaseline = { url: '', apiKey: '' }
  let tautulliLoaded = $state(false)
  let draftContinuation = $state<'off' | 'album-end' | 'radio'>('album-end')
  let draftShowNotifications = $state(true)
  let synced = $state(false)

  const warmer = $derived(plexState.warmerProgress)
  const warmerPct = $derived(
    warmer.total > 0 ? Math.round((warmer.done / warmer.total) * 100) : 0
  )

  async function startWarmer(): Promise<void> {
    await plexState.startLibraryWarmer()
  }
  async function stopWarmer(): Promise<void> {
    await plexState.stopLibraryWarmer()
  }

  // Race-bug guard: gate the draft-sync on settingsLoaded AND slskdConfig
  // being populated. Previously this fired the moment settingsOpen flipped
  // true, which beat the async `settings.get()` IPC — drafts got '' values,
  // synced locked in, and the next save wrote empty strings over real keys.
  // That was the actual "keys keep disappearing" mechanism.
  $effect(() => {
    if (
      plexState.settings.open &&
      plexState.settings.loaded &&
      // The public build strips slskd, so its config never loads — don't
      // block the rest of the settings sync waiting on it.
      (PUBLIC_BUILD || plexState.slskd.config) &&
      !synced
    ) {
      draftLastfm = plexState.settings.lastfmApiKey
      draftTagger = plexState.settings.taggerApiKey
      draftTicketmaster = plexState.settings.ticketmasterApiKey
      draftGeniusId = plexState.settings.geniusClientId
      draftGeniusSecret = plexState.settings.geniusClientSecret
      draftAdminToken = plexState.settings.plexAdminToken
      draftBijouUrl = plexState.settings.bijouUrl
      draftSlskdUrl = plexState.slskd.config?.url ?? ''
      draftSlskdKey = plexState.slskd.config?.apiKey ?? ''
      draftContinuation = plexState.settings.continuationMode
      draftShowNotifications = plexState.settings.showNotificationsEnabled
      synced = true
    }
    if (!plexState.settings.open && synced) {
      synced = false
    }
  })

  // Charts (Tautulli) config loads on its own — it isn't part of settings.get,
  // and unlike slskd it ships in both builds. Captures a baseline so save only
  // writes when the user actually changed it.
  $effect(() => {
    if (plexState.settings.open && !tautulliLoaded) {
      tautulliLoaded = true
      void window.cratedigger.charts.getConfig().then((c) => {
        draftTautulliUrl = c.url
        draftTautulliKey = c.apiKey
        tautulliBaseline = { url: c.url, apiKey: c.apiKey }
      })
    }
    if (!plexState.settings.open && tautulliLoaded) tautulliLoaded = false
  })

  function close(): void {
    plexState.settings.close()
  }

  async function save(): Promise<void> {
    const trimmedSlskdUrl = draftSlskdUrl.trim()
    const trimmedSlskdKey = draftSlskdKey.trim()
    const slskdChanged =
      trimmedSlskdUrl !== (plexState.slskd.config?.url ?? '') ||
      trimmedSlskdKey !== (plexState.slskd.config?.apiKey ?? '')
    await plexState.settings.save({
      lastfmApiKey: draftLastfm.trim(),
      taggerApiKey: draftTagger.trim(),
      ticketmasterApiKey: draftTicketmaster.trim(),
      geniusClientId: draftGeniusId.trim(),
      geniusClientSecret: draftGeniusSecret.trim(),
      plexAdminToken: draftAdminToken.trim(),
      bijouUrl: draftBijouUrl.trim(),
      continuationMode: draftContinuation,
      showNotificationsEnabled: draftShowNotifications
    })
    if (!PUBLIC_BUILD && slskdChanged) {
      await plexState.slskd.saveConfig(trimmedSlskdUrl, trimmedSlskdKey)
    }
    const tu = draftTautulliUrl.trim()
    const tk = draftTautulliKey.trim()
    if (tu !== tautulliBaseline.url || tk !== tautulliBaseline.apiKey) {
      await plexState.charts.saveConfig(tu, tk)
    }
    close()
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
  }

  let backupPath = $state('')
  $effect(() => {
    if (plexState.settings.open && !backupPath) {
      void window.cratedigger.secretsFile.getBackupPath().then((r) => {
        backupPath = r.path
      })
    }
  })

  async function revealBackupFile(): Promise<void> {
    await window.cratedigger.secretsFile.revealBackupFile()
  }

  let backupBusy = $state(false)
  let backupResult = $state<string | null>(null)
  async function backUpCurrentKeys(): Promise<void> {
    backupBusy = true
    backupResult = null
    try {
      const r = await window.cratedigger.secretsFile.backUpCurrentKeys()
      backupResult =
        r.written === 0
          ? 'No changes — file already matched the live keys.'
          : `Wrote ${r.written} key${r.written === 1 ? '' : 's'} to the backup file.`
    } catch (err) {
      backupResult = err instanceof Error ? err.message : String(err)
    } finally {
      backupBusy = false
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if plexState.settings.open}
  <div
    class="backdrop"
    onclick={(e) => { if (e.target === e.currentTarget) close() }}
    role="presentation"
  >
    <div class="modal" role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1">
      <header>
        <h2>Settings</h2>
        <button class="close" onclick={close} aria-label="Close">×</button>
      </header>
      <div class="body">
        <div class="field backup-row">
          <div class="field-label">Keys backup file</div>
          <div class="field-hint">
            Plain-text JSON outside the app's data dir. Anything filled in here seeds
            empty key fields at startup — so the next rename/migration won't wipe them.
            Settings edits still win over the file.
          </div>
          <div class="backup-actions">
            <button class="secondary" type="button" onclick={revealBackupFile}>
              Open backup file
            </button>
            <button
              class="secondary"
              type="button"
              disabled={backupBusy}
              onclick={() => void backUpCurrentKeys()}
              title="Mirror every currently-set key from this app into the backup file. Run this once after entering keys so they survive app rebrands, reinstalls, and machine switches."
            >
              {backupBusy ? 'Backing up…' : 'Back up keys now'}
            </button>
            {#if backupPath}<code class="backup-path">{backupPath}</code>{/if}
          </div>
          {#if backupResult}
            <div class="backup-result">{backupResult}</div>
          {/if}
        </div>
        <div class="field">
          <div class="field-label">When the album ends</div>
          <div class="field-hint">
            <strong>Stop</strong> ends playback with the explicit queue. <strong>Finish the
            record</strong> plays the album through, then silence. <strong>Radio</strong> keeps
            going — the next record is picked ahead of time and staged in the queue, where you
            can see it and swap it before it plays.
          </div>
          <div class="segmented" role="radiogroup" aria-label="When the album ends">
            <button
              type="button"
              class:active={draftContinuation === 'off'}
              onclick={() => (draftContinuation = 'off')}
            >Stop</button>
            <button
              type="button"
              class:active={draftContinuation === 'album-end'}
              onclick={() => (draftContinuation = 'album-end')}
            >Finish the record</button>
            <button
              type="button"
              class:active={draftContinuation === 'radio'}
              onclick={() => (draftContinuation = 'radio')}
            >Radio</button>
          </div>
        </div>
        <label class="field toggle-field">
          <input type="checkbox" bind:checked={draftShowNotifications} />
          <div class="toggle-text">
            <div class="field-label">Notify me when a library artist plays my venues</div>
            <div class="field-hint">
              Checks your tracked SF venues in the background while Cratedigger is open and
              pings you — native notification plus an in-app banner — when an artist already in
              your library is newly announced. Click the alert to jump to Shows.
            </div>
          </div>
        </label>
        <label class="field">
          <div class="field-label">Last.fm API key</div>
          <div class="field-hint">
            Used to fetch artist bios, album descriptions, and artist images when Plex or
            Wikipedia don't have them. Get a key at <a href="https://www.last.fm/api/account/create" target="_blank" rel="noreferrer">last.fm/api</a>.
          </div>
          <input
            type="password"
            bind:value={draftLastfm}
            placeholder="paste your API key"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        {#if !PUBLIC_BUILD}
        <label class="field">
          <div class="field-label">Tagger API key</div>
          <div class="field-hint">
            Shared secret sent on every request to the tagger service. Must match
            the <code>TAGGER_API_KEY</code> env var on the tagger host. The service refuses
            all mutating calls if either side is unset.
          </div>
          <input
            type="password"
            bind:value={draftTagger}
            placeholder="paste your tagger key"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        {/if}
        <label class="field">
          <div class="field-label">Ticketmaster Discovery API key</div>
          <div class="field-hint">
            Powers the Shows view for venues Ticketmaster controls (Fillmore family, Bill Graham,
            Masonic, Warfield, GAMH, Regency, August Hall). Get a free key at
            <a href="https://developer.ticketmaster.com/" target="_blank" rel="noreferrer">developer.ticketmaster.com</a>.
          </div>
          <input
            type="password"
            bind:value={draftTicketmaster}
            placeholder="paste your Ticketmaster Consumer Key"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        <label class="field">
          <div class="field-label">Genius Client ID</div>
          <div class="field-hint">
            Fallback lyrics source when lrclib.net has nothing — best coverage for hip-hop.
            Create an API client at
            <a href="https://genius.com/api-clients" target="_blank" rel="noreferrer">genius.com/api-clients</a>
            and paste its Client ID and Client Secret.
          </div>
          <input
            type="password"
            bind:value={draftGeniusId}
            placeholder="paste your Genius Client ID"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        <label class="field">
          <div class="field-label">Genius Client Secret</div>
          <input
            type="password"
            bind:value={draftGeniusSecret}
            placeholder="paste your Genius Client Secret"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        <label class="field">
          <div class="field-label">Tautulli URL</div>
          <div class="field-hint">
            Powers the Charts view. Tautulli watches your Plex server and records
            every user's plays — point this at your instance, e.g.
            <code>https://tautulli.example.com</code>.
          </div>
          <input
            type="text"
            bind:value={draftTautulliUrl}
            placeholder="https://your-tautulli"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        <label class="field">
          <div class="field-label">Tautulli API key</div>
          <div class="field-hint">
            From Tautulli → Settings → Web Interface → API. Read-only — Charts
            only pulls play history.
          </div>
          <input
            type="password"
            bind:value={draftTautulliKey}
            placeholder="paste your Tautulli API key"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        {#if !PUBLIC_BUILD}
        <label class="field">
          <div class="field-label">slskd URL</div>
          <div class="field-hint">
            Where the soulseek view talks to slskd. Point it at your slskd
            instance, e.g. <code>http://your-server:5030</code>.
          </div>
          <input
            type="text"
            bind:value={draftSlskdUrl}
            placeholder="http://your-server:5030"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        <label class="field">
          <div class="field-label">Plex admin token (cover-art edits)</div>
          <div class="field-hint">
            The Art Fixer writes cover art to Plex, which requires the
            server-owner account. Paste an owner <code>X-Plex-Token</code> here to
            let it edit while this app stays signed in as another account (e.g.
            the shop). Leave blank to use the signed-in account.
          </div>
          <input
            type="password"
            bind:value={draftAdminToken}
            placeholder="paste an owner X-Plex-Token"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        <label class="field">
          <div class="field-label">Bijou URL (grab notifications)</div>
          <div class="field-hint">
            When set, Cratedigger polls Bijou's RED ledger and pops a native
            notification whenever a tracked record gets grabbed. Leave blank
            to disable.
          </div>
          <input
            type="text"
            bind:value={draftBijouUrl}
            placeholder="https://bijou.your-domain"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        {/if}
        <div class="field warmer">
          <div class="field-label">Prefetch album credits & descriptions</div>
          <div class="field-hint">
            Walks the entire library and asks MusicBrainz / Last.fm / Wikipedia
            for credits and album descriptions, caches them on disk so the
            "looking up…" spinners stop appearing. Paced gently — expect this
            to run for hours, with a small pause between every album. Safe to
            stop and resume; cached items are skipped on the next run.
          </div>
          {#if warmer.total > 0}
            <div class="warmer-progress">
              <div class="bar"><div class="fill" style="width: {warmerPct}%"></div></div>
              <div class="warmer-stats">
                <span>{warmer.done} / {warmer.total}</span>
                <span class="muted">·</span>
                <span>{warmer.fetched} fetched</span>
                {#if warmer.errors > 0}
                  <span class="muted">·</span>
                  <span class="err">{warmer.errors} error{warmer.errors === 1 ? '' : 's'}</span>
                {/if}
              </div>
              {#if warmer.current}
                <div class="warmer-current" title={warmer.current}>{warmer.current}</div>
              {/if}
              {#if warmer.lastError}
                <div class="warmer-err" title={warmer.lastError}>
                  last error: {warmer.lastError}
                </div>
              {/if}
            </div>
          {/if}
          <div class="warmer-actions">
            {#if warmer.running}
              <button class="secondary" onclick={stopWarmer}>stop</button>
            {:else}
              <button class="secondary" onclick={startWarmer}>
                {warmer.total > 0 && warmer.done < warmer.total ? 'resume' : 'start'}
              </button>
            {/if}
          </div>
        </div>

        {#if !PUBLIC_BUILD}
        <label class="field">
          <div class="field-label">slskd API key</div>
          <div class="field-hint">
            Sent as <code>X-API-Key</code>. Must match an <code>api_keys</code> entry in
            your slskd.yml — Cratedigger needs the <code>administrator</code> role
            to enqueue downloads.
          </div>
          <input
            type="password"
            bind:value={draftSlskdKey}
            placeholder="paste your slskd key"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        {/if}
      </div>
      <footer>
        <button class="secondary" onclick={close}>cancel</button>
        <button class="primary" onclick={save}>save</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(var(--shadow-color), 0.25);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }
  .modal {
    width: 100%;
    max-width: 520px;
    max-height: calc(100vh - 4rem);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-xl);
    box-shadow: 0 30px 80px rgba(var(--shadow-color), 0.3);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.1rem 1.4rem;
    border-bottom: 1px solid var(--hairline);
  }
  header h2 { margin: 0; font-size: 1.1rem; font-weight: 600; }
  .close {
    background: transparent;
    border: 0;
    color: var(--faded);
    font-size: 1.6rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 0.2rem;
  }
  .close:hover { color: var(--espresso); }
  .body {
    padding: 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
  .backup-row { gap: 0.4rem; }
  .backup-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 0.4rem;
  }
  .backup-path {
    font-size: 0.7rem;
    color: var(--faded);
    word-break: break-all;
  }
  .backup-result {
    margin-top: 0.4rem;
    font-size: 0.78rem;
    color: var(--ok-fg);
  }
  .toggle-field {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 0.7rem;
    cursor: pointer;
  }
  .toggle-field input[type='checkbox'] {
    width: auto;
    margin-top: 0.15rem;
    accent-color: var(--brick);
    cursor: pointer;
  }
  .toggle-text { flex: 1; min-width: 0; }
  .toggle-text .field-hint { margin-bottom: 0; }
  .segmented {
    display: inline-flex;
    border: 1px solid var(--ink-tint-08);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .segmented button {
    background: transparent;
    border: 0;
    color: var(--faded);
    font: inherit;
    font-size: 0.78rem;
    padding: 0.35rem 0.85rem;
    cursor: pointer;
  }
  .segmented button + button { border-left: 1px solid var(--ink-tint-08); }
  .segmented button:hover { color: var(--espresso); background: var(--ink-tint-04); }
  .segmented button.active {
    background: var(--brick);
    color: var(--paper);
  }
  .field-label {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--espresso);
    margin-bottom: 0.35rem;
  }
  .field-hint {
    font-size: 0.78rem;
    color: var(--faded);
    margin-bottom: 0.65rem;
    line-height: 1.45;
  }
  .field-hint a { color: var(--brick); text-decoration: none; }
  .field-hint a:hover { text-decoration: underline; }
  .field-hint code {
    font-family: var(--font-mono);
    font-size: 0.74rem;
    background: var(--paper);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-xs);
    padding: 0.05rem 0.3rem;
    color: var(--walnut);
  }
  input {
    width: 100%;
    box-sizing: border-box;
    background: var(--paper);
    color: var(--espresso);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: 0.55rem 0.75rem;
    font-size: 0.88rem;
    font-family: var(--font-mono);
  }
  input:focus { outline: 2px solid var(--brick); outline-offset: 1px; border-color: transparent; }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 1rem 1.4rem;
    border-top: 1px solid var(--hairline);
  }
  .primary, .secondary {
    border-radius: var(--radius-md);
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .primary {
    background: var(--brick);
    color: var(--inset);
    font-weight: 600;
  }
  .primary:hover { background: var(--brick-deep); }
  .secondary {
    background: transparent;
    color: var(--walnut);
    border-color: var(--hairline);
  }
  .secondary:hover { border-color: var(--whisper); color: var(--espresso); }
  .warmer-progress { margin-bottom: 0.55rem; display: flex; flex-direction: column; gap: 0.4rem; }
  .warmer-progress .bar {
    width: 100%;
    height: 6px;
    background: var(--paper);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-xs);
    overflow: hidden;
  }
  .warmer-progress .fill {
    height: 100%;
    background: var(--brick);
    transition: width 0.4s ease;
  }
  .warmer-stats {
    display: flex;
    gap: 0.4rem;
    font-size: 0.75rem;
    color: var(--walnut);
    font-variant-numeric: tabular-nums;
  }
  .warmer-stats .muted { color: var(--faded); }
  .warmer-stats .err { color: var(--brick); }
  .warmer-current {
    font-size: 0.74rem;
    color: var(--faded);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .warmer-err {
    font-size: 0.72rem;
    color: var(--brick);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .warmer-actions { display: flex; gap: 0.5rem; }
</style>
