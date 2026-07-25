<script lang="ts">
  import { plexState } from '../lib/plex-state.svelte'
  import BackButton from '../lib/BackButton.svelte'
  import type { ArtFixCandidate } from '../../../shared/plex'

  const af = $derived(plexState.artFix)
  const current = $derived(af.current)
  const scan = $derived(af.scanProgress)

  // Manual-search fields, reset to the current album whenever it changes.
  let searchArtist = $state('')
  let searchAlbum = $state('')
  let lastRk = $state<string | null>(null)
  $effect(() => {
    const c = af.current
    if (c && c.rk !== lastRk) {
      lastRk = c.rk
      searchArtist = c.artist
      searchAlbum = c.album
    }
  })

  const currentArt = $derived(current ? plexState.thumbUrl(current.thumb, 480, current.rk) : null)

  function resBadge(short: number | null): string {
    return short === null ? '?px' : `${short}px`
  }
  function onImgError(e: Event): void {
    const el = e.currentTarget as HTMLImageElement
    el.style.visibility = 'hidden'
  }
  async function runSearch(): Promise<void> {
    await af.manualSearch(searchArtist, searchAlbum)
  }
</script>

<section>
  <header>
    <BackButton onclick={() => plexState.closeArtFixer()} />
    <div class="titles">
      <div class="label">album art fixer</div>
      <div class="subtitle">
        {#if af.loading && af.queue.length === 0}
          loading…
        {:else}
          {af.remaining} to review
          {#if af.source === 'seed'}· seed snapshot{:else if af.scannedAt}· live scan{/if}
          {#if af.acceptedCount > 0 || af.skippedCount > 0}
            · {af.acceptedCount} fixed · {af.skippedCount} skipped
          {/if}
        {/if}
      </div>
    </div>
    <div class="right">
      {#if scan?.running}
        <div class="scan-progress" title={scan.current ?? ''}>
          <span>{scan.done}/{scan.total} · {scan.lowRes} low-res</span>
          <button class="secondary small" onclick={() => af.cancelScan()}>stop</button>
        </div>
      {:else}
        <button class="secondary" onclick={() => void af.rescan()} title="Re-measure every album's cover live from Plex (slow, self-healing)">
          re-scan library
        </button>
      {/if}
      <button class="secondary" onclick={() => void af.revertLast()} title="Undo the most recent accepted cover">
        revert last
      </button>
    </div>
  </header>

  {#if af.error}
    <p class="error">{af.error}</p>
  {/if}

  {#if !current}
    <div class="empty">
      {#if af.loading}
        <p class="hint">loading queue…</p>
      {:else}
        <p class="done">🎉 queue clear — no low-res covers left to review.</p>
        <button class="secondary" onclick={() => void af.rescan()}>re-scan library</button>
      {/if}
    </div>
  {:else}
    <div class="deck">
      <!-- Current cover -->
      <div class="current">
        <div class="art-frame">
          {#if currentArt}
            <img src={currentArt} alt="current cover" />
          {:else}
            <div class="art-fallback">{current.album.slice(0, 1)}</div>
          {/if}
          <span class="badge current-badge">current · {resBadge(current.short)}</span>
        </div>
        <div class="meta">
          <div class="title">{current.album}</div>
          <div class="artist">{current.artist}{current.year ? ` · ${current.year}` : ''}</div>
          {#if current.seed}
            <div class="seed" class:mismatch={current.seed.bsim < 0.8}>
              Deezer matched <strong>{current.seed.deezerArtist} — {current.seed.deezerTitle}</strong>
              <span class="sims">artist {Math.round(current.seed.asim * 100)}% · title {Math.round(current.seed.bsim * 100)}%</span>
            </div>
          {/if}
        </div>
        <div class="card-actions">
          <button class="skip" disabled={af.applying} onclick={() => void af.skip()}>skip</button>
        </div>
      </div>

      <!-- Candidates -->
      <div class="candidates">
        <div class="search">
          <input type="text" bind:value={searchArtist} placeholder="artist" aria-label="search artist" />
          <input
            type="text"
            bind:value={searchAlbum}
            placeholder="album"
            aria-label="search album"
            onkeydown={(e) => { if (e.key === 'Enter') void runSearch() }}
          />
          <button class="secondary small" onclick={() => void runSearch()}>search</button>
        </div>

        {#if af.candidatesLoading && af.candidates.length === 0}
          <p class="hint">finding candidates…</p>
        {:else if af.candidates.length === 0}
          <p class="hint">no candidates found. try a manual search above.</p>
        {:else}
          <div class="grid">
            {#each af.candidates as c, i (`${c.source}:${i}:${c.url}`)}
              {@const best = i === 0}
              <div class="tile" class:best class:alt={c.altEdition}>
                <div class="tile-art">
                  <img src={c.thumbUrl} alt={c.label ?? c.source} loading="lazy" onerror={onImgError} />
                  <span class="badge res-badge" class:up={(c.short ?? 0) > current.short}>{resBadge(c.short)}</span>
                  {#if best}<span class="badge best-badge">best</span>{/if}
                  {#if c.altEdition}<span class="badge alt-badge" title="Looks like a deluxe/remaster edition">alt</span>{/if}
                </div>
                <div class="tile-meta">
                  <span class="src">{c.source}</span>
                  {#if c.label}<span class="lbl" title={c.label}>{c.label}</span>{/if}
                </div>
                <button
                  class="accept"
                  class:primary={best}
                  disabled={af.applying}
                  onclick={() => void af.accept(c)}
                >
                  {af.applying ? '…' : 'use this'}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
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
  .titles { display: flex; flex-direction: column; gap: 0.15rem; }
  .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--faded);
  }
  .subtitle { font-size: 1.05rem; font-weight: 600; }
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
  .secondary:hover { color: var(--espresso); }
  .secondary.small { padding: 0.25rem 0.7rem; font-size: 0.75rem; }
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

  .error { color: var(--err-fg); }
  .hint { color: var(--faded); }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }
  .done { font-size: 1.15rem; }

  .deck {
    display: grid;
    grid-template-columns: 360px 1fr;
    gap: 1.5rem;
    flex: 1;
    min-height: 0;
  }

  .current {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .art-frame, .tile-art { position: relative; }
  .art-frame img, .art-fallback {
    width: 100%;
    aspect-ratio: 1;
    border-radius: var(--radius-lg);
    object-fit: cover;
    display: block;
    background: var(--surface);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
  }
  .art-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 4rem;
    font-weight: 700;
    color: var(--whisper);
  }
  .badge {
    position: absolute;
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 0.12rem 0.5rem;
    border-radius: var(--radius-pill);
    font-variant-numeric: tabular-nums;
  }
  .current-badge {
    bottom: 0.5rem;
    left: 0.5rem;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
  }
  .meta .title { font-size: 1.05rem; font-weight: 600; }
  .meta .artist { font-size: 0.85rem; color: var(--faded); }
  .seed {
    margin-top: 0.5rem;
    font-size: 0.78rem;
    color: var(--faded);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    padding: 0.45rem 0.6rem;
  }
  .seed.mismatch {
    border-color: var(--brick);
    color: var(--brick-deep);
    background: var(--brick-wash);
  }
  .seed .sims { display: block; margin-top: 0.2rem; font-variant-numeric: tabular-nums; }
  .card-actions { margin-top: auto; }
  .skip {
    width: 100%;
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--faded);
    padding: 0.5rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
    font-size: 0.85rem;
  }
  .skip:hover { color: var(--espresso); border-color: var(--whisper); }

  .candidates {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    min-height: 0;
  }
  .search { display: flex; gap: 0.5rem; }
  .search input {
    flex: 1;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    padding: 0.4rem 0.8rem;
    color: var(--espresso);
    font-size: 0.82rem;
  }
  .search input:focus { outline: none; border-color: var(--brick); }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 1rem;
    overflow-y: auto;
    padding-right: 0.5rem;
    align-content: start;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem;
    border-radius: var(--radius-lg);
    border: 1px solid var(--hairline);
    background: var(--surface);
  }
  .tile.best { border-color: var(--brick); box-shadow: inset 0 0 0 1px var(--brick); }
  .tile.alt { opacity: 0.92; }
  .tile-art img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: var(--radius-md);
    display: block;
    background: var(--inset);
  }
  .res-badge {
    bottom: 0.35rem;
    right: 0.35rem;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
  }
  .res-badge.up { background: var(--ok-bg); color: var(--ok-fg); }
  .best-badge {
    top: 0.35rem;
    left: 0.35rem;
    background: var(--brick);
    color: #fff;
  }
  .alt-badge {
    top: 0.35rem;
    right: 0.35rem;
    background: var(--brick-wash);
    color: var(--brick-deep);
    border: 1px solid var(--brick);
  }
  .tile-meta {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .src {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--walnut);
  }
  .lbl {
    font-size: 0.74rem;
    color: var(--faded);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .accept {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--walnut);
    padding: 0.35rem;
    border-radius: var(--radius-pill);
    font-size: 0.78rem;
    cursor: pointer;
  }
  .accept:hover:not(:disabled) { border-color: var(--brick); color: var(--brick); }
  .accept.primary {
    background: var(--brick);
    color: var(--inset);
    border-color: var(--brick);
    font-weight: 600;
  }
  .accept:disabled { opacity: 0.5; cursor: default; }
</style>
