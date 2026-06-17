<script lang="ts">
  import type { AlbumCredits, PlexTrack } from '../../../../shared/plex'
  import { plexState } from '../plex-state.svelte'
  import { formatArtists, formatDuration } from './helpers'

  // The track list with inline lyrics. The active-track highlight / "NOW"
  // marker only fire when `activeTrackKey` matches — album-detail passes null
  // so the rows stay inert there; now-playing passes the timeline's track.
  let {
    tracks,
    credits,
    albumArtist,
    albumTitle,
    activeTrackKey = null,
    onTrackClick,
    onTrackContextMenu
  }: {
    tracks: PlexTrack[]
    credits: AlbumCredits | null
    albumArtist: string
    albumTitle: string
    activeTrackKey?: string | null
    onTrackClick: (trackRatingKey: string, title: string) => void
    onTrackContextMenu: (e: MouseEvent, trackRatingKey: string, title: string) => void
  } = $props()

  const canCast = $derived(!!plexState.playback.activePlayerId)
  const castBusy = $derived(plexState.playback.castBusy)
  const activeName = $derived(plexState.playback.activePlayerName() ?? '')

  // Copy-to-clipboard for a track's lyrics. Manual drag-select can be fiddly
  // over the scrolling panel, so a one-click copy is the reliable path. Tracks
  // which row just copied so the button can flash a confirmation.
  let copiedKey = $state<string | null>(null)
  let copiedTimer: ReturnType<typeof setTimeout> | null = null
  async function copyLyrics(key: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      copiedKey = key
      if (copiedTimer !== null) clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => {
        copiedKey = null
      }, 1600)
    } catch {
      // Clipboard write denied — the text is still selectable as a fallback.
    }
  }
</script>

<ol class="tracks">
  {#each tracks as t (t.ratingKey)}
    {@const mbArtists = credits?.trackArtists?.[t.ratingKey] ?? []}
    {@const isActive = t.ratingKey === activeTrackKey}
    {@const lyricsState = plexState.lyrics.byTrack[t.ratingKey]}
    {@const lyricsOpen = !!plexState.lyrics.openByTrack[t.ratingKey]}
    <li class:active={isActive} oncontextmenu={(e) => onTrackContextMenu(e, t.ratingKey, t.title)}>
      <div class="t-row">
        <span class="idx">
          {#if isActive}
            <span class="active-indicator" aria-label="Now playing">
              <span></span><span></span><span></span>
            </span>
          {:else}{t.index ?? ''}{/if}
        </span>
        <button
          class="t-play"
          title={isActive ? 'Currently playing' : `Play on ${activeName || 'selected player'}`}
          onclick={() => onTrackClick(t.ratingKey, t.title)}
          disabled={!canCast || castBusy}
        >▶</button>
        <span class="t-title">
          {#if isActive}<span class="now-mark">▶ NOW</span>{/if}
          {t.title}
        </span>
        <span class="t-artist">
          {#if mbArtists.length > 0}
            {#each mbArtists as p, i (p.mbid)}
              {#if i > 0}<span class="t-sep">, </span>{/if}
              <button
                class="t-artist-link"
                onclick={() => void plexState.openEntity(p.mbid, p.name)}
                title={`Open ${p.name}`}
              >{p.name}</button>
            {/each}
          {:else}{formatArtists(t.originalTitle)}{/if}
        </span>
        <span class="dur">{formatDuration(t.duration)}</span>
        <button
          class="t-lyrics"
          class:open={lyricsOpen}
          title={lyricsOpen ? 'Hide lyrics' : 'Show lyrics'}
          onclick={() =>
            void plexState.lyrics.toggle({
              trackRatingKey: t.ratingKey,
              artist: albumArtist,
              title: t.title,
              album: albumTitle,
              durationMs: t.duration
            })}
        >{lyricsOpen ? 'hide' : 'lyrics'}</button>
      </div>
      {#if lyricsOpen}
        <div class="lyrics-panel">
          {#if lyricsState === 'loading'}
            <p class="lyrics-hint">looking up lyrics…</p>
          {:else if lyricsState === 'error'}
            <p class="lyrics-err">couldn't reach the lyrics services — try again later.</p>
          {:else if lyricsState === null || lyricsState === undefined}
            <p class="lyrics-hint">no lyrics found for this track.</p>
          {:else if lyricsState.instrumental}
            <p class="lyrics-hint">instrumental.</p>
          {:else if lyricsState.plainLyrics}
            {@const body = lyricsState.plainLyrics}
            <pre class="lyrics-body">{body}</pre>
            <div class="lyrics-foot">
              <button
                class="lyrics-copy"
                type="button"
                onclick={() => void copyLyrics(t.ratingKey, body)}
              >{copiedKey === t.ratingKey ? 'copied ✓' : 'copy'}</button>
              {#if lyricsState.url}
                <a class="lyrics-src" href={lyricsState.url} target="_blank" rel="noreferrer"
                  >{lyricsState.source === 'genius' ? 'Genius' : 'lrclib.net'} ↗</a>
              {/if}
            </div>
          {:else}
            <p class="lyrics-hint">no plain-text lyrics available for this track.</p>
          {/if}
        </div>
      {/if}
    </li>
  {/each}
</ol>

<style>
  .tracks {
    list-style: none;
    padding: 0;
    margin: 2rem 0 0;
    display: flex;
    flex-direction: column;
  }
  .tracks li {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--ink-tint-04);
    border-radius: var(--radius-md);
    transition: background 120ms ease;
  }
  .t-row {
    display: grid;
    grid-template-columns: 2rem 1.75rem 1fr auto 3.5rem auto;
    gap: 0.75rem;
    padding: 0.6rem 0.5rem;
    align-items: center;
  }
  .tracks li:hover {
    background: rgba(255, 255, 255, 0.025);
  }
  .tracks li.active {
    background: rgba(140, 53, 34, 0.14);
    box-shadow: inset 4px 0 0 var(--brick);
  }
  .tracks li.active .t-title {
    color: var(--espresso);
    font-weight: 700;
  }
  .tracks li.active .idx,
  .tracks li.active .dur {
    color: var(--brick);
  }
  .tracks li.active .t-play {
    color: var(--brick);
  }
  .t-play {
    background: transparent;
    border: 0;
    color: var(--faded);
    cursor: pointer;
    padding: 0.2rem 0.35rem;
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
  }
  .tracks li:hover .t-play:not(:disabled) {
    color: var(--espresso);
  }
  .t-play:not(:disabled):hover {
    color: var(--brick);
    background: var(--hairline);
  }
  .t-play:disabled {
    opacity: 0;
    pointer-events: none;
  }
  .idx {
    color: var(--faded);
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .active-indicator {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 14px;
  }
  .active-indicator span {
    width: 3px;
    background: var(--brick);
    border-radius: 1px;
    animation: bar 1s ease-in-out infinite;
  }
  .active-indicator span:nth-child(1) {
    animation-delay: 0s;
  }
  .active-indicator span:nth-child(2) {
    animation-delay: 0.2s;
  }
  .active-indicator span:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes bar {
    0%,
    100% {
      height: 4px;
    }
    50% {
      height: 14px;
    }
  }
  .t-title {
    font-size: 0.95rem;
  }
  .now-mark {
    display: inline-block;
    background: var(--brick);
    color: var(--inset);
    font-weight: 800;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    padding: 0.1rem 0.45rem;
    border-radius: var(--radius-sm);
    margin-right: 0.5rem;
    vertical-align: middle;
  }
  .t-artist {
    color: var(--faded);
    font-size: 0.85rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .t-artist-link {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--brick);
    font: inherit;
    cursor: pointer;
    border-bottom: 1px solid transparent;
  }
  .t-artist-link:hover {
    border-bottom-color: var(--brick);
  }
  .t-sep {
    color: var(--faded);
  }
  .dur {
    color: var(--faded);
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    text-align: right;
  }
  .t-lyrics {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--walnut);
    cursor: pointer;
    padding: 0.15rem 0.5rem;
    border-radius: var(--radius-pill);
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
  }
  .t-lyrics:hover,
  .t-lyrics.open {
    color: var(--brick);
    border-color: var(--brick);
    background: var(--hairline);
  }
  .lyrics-panel {
    padding: 0.5rem 0.5rem 0.9rem 4.5rem;
    background: rgba(255, 255, 255, 0.02);
  }
  .lyrics-hint,
  .lyrics-err {
    margin: 0.25rem 0;
    color: var(--faded);
    font-size: 0.82rem;
  }
  .lyrics-err {
    color: var(--err-fg);
  }
  .lyrics-body {
    margin: 0;
    padding: 0;
    font-family: inherit;
    font-size: 0.88rem;
    line-height: 1.55;
    white-space: pre-wrap;
    color: var(--espresso);
    /* Explicitly selectable + outside any window-drag region, so manual
       select-and-copy works alongside the copy button. */
    user-select: text;
    -webkit-user-select: text;
    cursor: text;
    -webkit-app-region: no-drag;
  }
  /* The global ::selection uses --brick-wash, a pale tint that disappears on
     dark themes — so a highlight was happening but invisible. Pin the lyrics
     selection to fixed brick/cream (like the format badges) so the highlight
     reads on any theme. */
  .lyrics-body::selection {
    background: #8c3522;
    color: #fffbef;
  }
  .lyrics-body::-moz-selection {
    background: #8c3522;
    color: #fffbef;
  }
  .lyrics-foot {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    margin-top: 0.5rem;
  }
  .lyrics-copy {
    background: none;
    border: 0;
    padding: 0;
    color: var(--faded);
    font: inherit;
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .lyrics-copy:hover {
    color: var(--brick);
  }
  .lyrics-src {
    color: var(--faded);
    text-decoration: none;
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .lyrics-src:hover {
    color: var(--brick);
  }
</style>
