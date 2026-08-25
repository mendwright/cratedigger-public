<script lang="ts">
  import type { AlbumCredits, CreditPerson, PlexTrack } from '../../../../shared/plex'
  import {
    projectDiscGroups,
    hasMultipleDiscs,
    projectClassicalTracks,
    hasWorkStructure
  } from '../../../../shared/classical-tracks'
  import { plexState } from '../plex-state.svelte'
  import { formatArtists, formatDuration } from './helpers'
  import {
    classicalTrackPerformers,
    isClassicalRepertoire,
    modelAssertsRepertoire
  } from '../../../../shared/classical-model'
  import { compactTitle } from '../../../../shared/title-match'

  // The track list with inline lyrics. The active-track highlight / "NOW"
  // marker only fire when `activeTrackKey` matches — album-detail passes null
  // so the rows stay inert there; now-playing passes the timeline's track.
  let {
    tracks,
    credits,
    albumArtist,
    albumTitle,
    genres = [],
    activeTrackKey = null,
    onTrackClick,
    onTrackContextMenu
  }: {
    tracks: PlexTrack[]
    credits: AlbumCredits | null
    albumArtist: string
    albumTitle: string
    genres?: string[]
    activeTrackKey?: string | null
    onTrackClick: (trackRatingKey: string, title: string) => void
    onTrackContextMenu: (e: MouseEvent, trackRatingKey: string, title: string) => void
  } = $props()

  const canCast = $derived(!!plexState.playback.activePlayerId)
  const castBusy = $derived(plexState.playback.castBusy)
  const activeName = $derived(plexState.playback.activePlayerName() ?? '')

  // Classical box sets arrive as one album with 13 discs; Plex hands us a flat
  // track list whose `index` restarts each disc, so without disc dividers the
  // numbers march 1..25, 1..25, ... with no seam. Group into discs (a pure,
  // identity-preserving projection) and only surface headers for real
  // multi-disc sets — single-disc albums render exactly as before.
  const discGroups = $derived(projectDiscGroups(tracks))
  const showDiscHeaders = $derived(hasMultipleDiscs(discGroups))

  // Classical work → movement grouping: nest movement rows under a work header
  // ("Piano Sonata No. 14 · Beethoven"), walking MusicBrainz's parent-work
  // relations. Only engages when the reconciled model actually found multi-
  // movement works; otherwise the disc/flat rendering above stands. Composer
  // is repeated at the work level only on multi-composer albums (recitals) —
  // single-composer records already say it once in the header.
  const classical = $derived(credits?.classical ?? null)
  // Same test AlbumMeta uses: the album is classical when its genre tags say
  // so or the aligned work graph is unmistakably repertoire-shaped. Nearly
  // every album carries *some* classical model (MB gives pop songs the same
  // work skeleton), so the model's mere presence must never flip the rows —
  // it once put every Queensrÿche session player on every Mindcrime track.
  const isClassical = $derived(
    isClassicalRepertoire(genres) || modelAssertsRepertoire(classical)
  )
  const albumArtistKey = $derived(compactTitle(albumArtist))

  // Per-row artist names. Classical albums list the performers on each
  // movement (soloists and ensembles change track to track). Everything else
  // gets MusicBrainz's track artist credit — meaningful on compilations and
  // guest features, pure noise when it just repeats the album artist on every
  // row, so that case renders nothing (the Plex originalTitle fallback stays).
  function rowArtists(t: PlexTrack): CreditPerson[] {
    if (isClassical) return classicalTrackPerformers(credits?.byTrack?.[t.ratingKey] ?? [])
    const people = credits?.trackArtists?.[t.ratingKey] ?? []
    if (people.length === 1 && compactTitle(people[0].name) === albumArtistKey) return []
    return people
  }
  // Only nest movements under works when MusicBrainz alignment is trustworthy —
  // exact (all GUID) or strong (full disc/index under an exact whole-release
  // signature match). weak/none render flat, so a mismatched disc layout can't
  // group movements under the wrong work.
  const worksTrusted = $derived(
    classical?.alignmentConfidence === 'exact' ||
      classical?.alignmentConfidence === 'strong'
  )
  const workDiscs = $derived(
    // modelAssertsRepertoire keeps pop albums flat: MB gives their songs the
    // same work skeleton, and without this gate a band's songbook could nest
    // under "works" it never had.
    worksTrusted && modelAssertsRepertoire(classical) && classical
      ? projectClassicalTracks(discGroups, classical.byTrack)
      : null
  )
  const showWorks = $derived(!!workDiscs && hasWorkStructure(workDiscs))
  const multiComposer = $derived((classical?.composers.length ?? 0) > 1)

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

{#snippet trackRow(t: PlexTrack, label?: string)}
    {@const mbArtists = rowArtists(t)}
    {@const isActive = t.ratingKey === activeTrackKey}
    {@const lyricsState = plexState.lyrics.byTrack[t.ratingKey]}
    {@const lyricsOpen = !!plexState.lyrics.openByTrack[t.ratingKey]}
    <li data-track class:active={isActive} oncontextmenu={(e) => onTrackContextMenu(e, t.ratingKey, t.title)}>
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
          {label ?? t.title}
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
                  >{lyricsState.source === 'genius'
                    ? 'Genius'
                    : lyricsState.source === 'bandcamp'
                      ? 'Bandcamp'
                      : 'lrclib.net'} ↗</a>
              {/if}
            </div>
          {:else}
            <p class="lyrics-hint">no plain-text lyrics available for this track.</p>
          {/if}
        </div>
      {/if}
    </li>
{/snippet}

{#snippet discHead(discNumber: number | null)}
  <h3 class="disc-head">
    {#if discNumber === null}
      <span class="disc-word">Other</span>
    {:else}
      <span class="disc-word">Disc</span> <span class="disc-num">{discNumber}</span>
    {/if}
  </h3>
{/snippet}

{#if showWorks && workDiscs}
  {#each workDiscs as disc (disc.discNumber ?? 'other')}
    <section class="disc">
      {#if showDiscHeaders}{@render discHead(disc.discNumber)}{/if}
      {#each disc.groups as group (group.key)}
        {#if group.title !== null && group.movements.length > 1}
          <div class="work">
            <div class="work-head">
              <span class="work-title">{group.title}</span>
              {#if multiComposer && group.composers.length > 0}
                <span class="work-composers"
                  >{#each group.composers as c, i (c.mbid)}{#if i > 0}<span class="work-sep"> · </span>{/if}<button
                      class="work-composer-link"
                      onclick={() => void plexState.openEntity(c.mbid, c.name)}
                      title={`Open ${c.name}`}>{c.name}</button>{/each}</span>
              {/if}
            </div>
            <ol data-tracks="album" class="tracks work-tracks">
              {#each group.movements as m (m.track.ratingKey)}
                {@render trackRow(m.track, m.movementLabel)}
              {/each}
            </ol>
          </div>
        {:else}
          <ol data-tracks="album" class="tracks">
            {#each group.movements as m (m.track.ratingKey)}
              {@render trackRow(m.track)}
            {/each}
          </ol>
        {/if}
      {/each}
    </section>
  {/each}
{:else if showDiscHeaders}
  {#each discGroups as group (group.discNumber ?? 'other')}
    <section class="disc">
      {@render discHead(group.discNumber)}
      <ol data-tracks="album" class="tracks disc-tracks">
        {#each group.tracks as t (t.ratingKey)}
          {@render trackRow(t)}
        {/each}
      </ol>
    </section>
  {/each}
{:else}
  <ol data-tracks="album" class="tracks">
    {#each tracks as t (t.ratingKey)}
      {@render trackRow(t)}
    {/each}
  </ol>
{/if}

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
    background: var(--ink-tint-04);
  }
  .tracks li.active {
    background: color-mix(in srgb, var(--brick) 14.0%, transparent);
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
    background: var(--ink-tint-04);
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
    background: var(--brick);
    color: var(--inset);
  }
  .lyrics-body::-moz-selection {
    background: var(--brick);
    color: var(--inset);
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
  /* Multi-disc box sets get a side-marker per disc — reads like the spine
     label on a vinyl side, so a 13-CD complete edition scans as discs, not
     one endless list. Only rendered when the projection finds >1 real disc. */
  .disc {
    margin-top: 1.85rem;
  }
  .disc:first-of-type {
    margin-top: 2rem;
  }
  .disc-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0;
    padding: 0 0.5rem 0.5rem;
    border-bottom: 1px solid var(--ink-tint-06);
  }
  .disc-word {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--faded);
    font-weight: 600;
  }
  .disc-num {
    color: var(--brick);
    font-family: var(--font-display, inherit);
    font-variant-numeric: tabular-nums;
    font-size: 1rem;
    font-weight: 700;
    line-height: 1;
  }
  .disc-tracks {
    margin-top: 0.35rem;
  }
  /* Track lists inside a disc section are tight — the disc/work headers own
     the vertical rhythm, not the 2rem margin the standalone list uses. */
  .disc .tracks {
    margin-top: 0.35rem;
  }
  /* A work is a titled group of movements. The header names the work (and, on
     recital albums, its composer); a hairline down the left edge ties the
     movement rows to it — the Roon-style "these belong together" cue. */
  .work {
    margin-top: 1.3rem;
  }
  .work:first-child {
    margin-top: 0.6rem;
  }
  .work-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0 0.5rem 0.3rem;
  }
  .work-title {
    font-family: var(--font-display, inherit);
    font-size: 1.02rem;
    font-weight: 600;
    line-height: 1.15;
    color: var(--espresso);
  }
  .work-composers {
    font-size: 0.78rem;
    color: var(--faded);
  }
  .work-composer-link {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--brick);
    font: inherit;
    cursor: pointer;
    border-bottom: 1px solid transparent;
  }
  .work-composer-link:hover {
    border-bottom-color: var(--brick);
  }
  .work-sep {
    color: var(--whisper);
  }
  .work-tracks {
    border-left: 2px solid var(--ink-tint-06);
    margin-left: 0.5rem;
    padding-left: 0.25rem;
  }
</style>
