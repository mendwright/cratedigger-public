<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { AlbumCredits, AlbumDetail, AlbumMediaInfo, Bio } from '../../../../shared/plex'
  import { classicalAlbumPerformers, isClassicalRepertoire, modelAssertsRepertoire, resolveEffectiveComposers } from '../../../../shared/classical-model'
  import type { ComposerSearchResult } from '../../../../shared/classical-model'
  import { plexState } from '../plex-state.svelte'
  import { safeExternalHref } from '../../../../shared/urls'
  import { albumStats, editionChips, tokenizeSummary } from './helpers'

  // The hero text column: kicker, title, the artist/year/track/genre subline,
  // edition chips, the stats row (play count, last spun, media info), the
  // Play Album action, and the album summary with linkified band members.
  let {
    detail,
    credits,
    bio,
    bioLoading,
    hasPlexSummary,
    originalYear,
    mediaInfo = null,
    afterChips
  }: {
    detail: AlbumDetail
    credits: AlbumCredits | null
    bio: Bio | null
    bioLoading: boolean
    hasPlexSummary: boolean
    originalYear: number | null
    mediaInfo?: AlbumMediaInfo | null
    // Optional slot rendered just below the edition chips (where the now-removed
    // release-country chip sat) — Now Playing injects its "playing near you"
    // shows callout here so it reads as part of the header, not a buried rail.
    afterChips?: Snippet
  } = $props()

  const chips = $derived(editionChips(credits))
  const stats = $derived(albumStats(detail, mediaInfo))
  const summaryTokens = $derived(
    detail.summary ? tokenizeSummary(detail.summary, credits?.members ?? []) : []
  )

  const canCast = $derived(!!plexState.playback.activePlayerId)
  const castBusy = $derived(plexState.playback.castBusy)
  const activeName = $derived(plexState.playback.activePlayerName() ?? '')

  // Classical: composer is the identity Plex browses right past (it keys on the
  // performer). The effective composer is a manual override if pinned, else the
  // MusicBrainz model but only when its track alignment is trustworthy (exact |
  // strong) — a weak/unaligned model never asserts a composer ("unknown over
  // wrong"). For box sets MB can't align (Gulda), the user pins the obvious
  // composer; that override wins the hero line but never authorizes work nesting.
  const classical = $derived(credits?.classical ?? null)
  const composerOverride = $derived(
    plexState.composerOverride.get(detail.album.ratingKey) ?? null
  )
  const effectiveComposers = $derived(resolveEffectiveComposers(classical, composerOverride))
  // The album counts as classical when its genre tags say so or the aligned
  // work graph is unmistakably repertoire-shaped. MB models pop songs with the
  // same work skeleton, so an existing model alone must never flip an album's
  // presentation — that once replaced the band Divorce with its lead writer.
  const isClassical = $derived(
    isClassicalRepertoire(detail.genres) || modelAssertsRepertoire(classical)
  )
  // A pinned composer is explicit user intent and always shows; MB-derived
  // composers and the performer-for-artist swap engage only on classical albums.
  const composers = $derived(
    effectiveComposers.source === 'override' || isClassical ? effectiveComposers.people : []
  )
  const programPerformers = $derived(isClassical ? classicalAlbumPerformers(credits) : [])
  const composerIsOverride = $derived(effectiveComposers.source === 'override')
  // Offer to pin a composer only on classical albums with none resolved — never
  // sprout a "pin composer" prompt on a pop record.
  const canPinComposer = $derived(effectiveComposers.source === 'none' && isClassical)
  let composerGuess = $state<ComposerSearchResult | null>(null)
  let guessSeq = 0

  // Composer picker (mirrors the year editor below). Prefills from a
  // "Composer: …" style album title so pinning is usually one confirm.
  let pickingComposer = $state(false)
  let composerDraft = $state('')
  let composerError = $state('')
  let composerSaving = $state(false)
  let composerInput = $state<HTMLInputElement | null>(null)

  function defaultComposerName(): string {
    const colon = detail.album.title.indexOf(':')
    return colon > 0 ? detail.album.title.slice(0, colon).trim() : ''
  }
  $effect(() => {
    const ratingKey = detail.album.ratingKey
    const query = defaultComposerName()
    const shouldGuess = canPinComposer && !!query
    const seq = ++guessSeq
    composerGuess = null
    if (shouldGuess) {
      void plexState.composerOverride.guess(query).then((guess) => {
        if (seq === guessSeq && detail.album.ratingKey === ratingKey) composerGuess = guess
      }).catch(() => {})
    }
  })
  function openComposerPicker(): void {
    composerDraft = composerOverride?.name ?? defaultComposerName()
    composerError = ''
    pickingComposer = true
  }
  async function saveComposer(): Promise<void> {
    const name = composerDraft.trim()
    if (!name) {
      composerError = 'Enter a composer name'
      return
    }
    composerSaving = true
    composerError = ''
    const resolved = await plexState.composerOverride.resolve(name)
    composerSaving = false
    if (!resolved) {
      composerError = `No MusicBrainz match for "${name}"`
      return
    }
    await plexState.composerOverride.set(detail.album.ratingKey, resolved)
    pickingComposer = false
  }
  // Close the picker when the album changes out from under us; focus on open.
  $effect(() => {
    detail.album.ratingKey
    pickingComposer = false
  })
  $effect(() => {
    if (pickingComposer && composerInput) composerInput.select()
  })

  function playAlbum(): void {
    void plexState.playback.requestCastAlbum(detail.album.ratingKey, detail.album.title, detail.album.artist)
  }

  // Manual original-year override. The auto year is the MusicBrainz release-group
  // date, which is wrong for box sets / "complete" compilations (a 1957 session
  // first boxed in 1999); the user pins the real year here.
  const hasYearOverride = $derived(plexState.originalYear.get(detail.album.ratingKey) != null)
  // The year actually shown in the header. A manual override wins over the
  // `originalYear` prop the screen passed in — this keeps AlbumMeta authoritative
  // whether it's rendered by the album-detail view or the now-playing screen
  // (which computes its own prop and wouldn't otherwise know about the override).
  const displayYear = $derived(plexState.originalYear.get(detail.album.ratingKey) ?? originalYear)
  let editingYear = $state(false)
  let yearDraft = $state('')
  let yearError = $state('')
  let yearInput = $state<HTMLInputElement | null>(null)

  // Close the editor when the album changes out from under us.
  $effect(() => {
    detail.album.ratingKey
    editingYear = false
  })
  $effect(() => {
    if (editingYear && yearInput) yearInput.select()
  })

  function openYearEditor(): void {
    yearDraft = String(displayYear ?? detail.album.year ?? '')
    yearError = ''
    editingYear = true
  }

  // The auto (MusicBrainz-derived) original year, ignoring any override — what
  // the album reverts to when the override is cleared.
  const autoYear = $derived(
    credits?.originalDate ? parseInt(credits.originalDate.slice(0, 4), 10) || null : null
  )

  async function saveYear(): Promise<void> {
    const y = parseInt(yearDraft.trim(), 10)
    if (!Number.isFinite(y) || y < 1000 || y > 2200) {
      yearError = 'Enter a 4-digit year'
      return
    }
    await plexState.originalYear.set(detail.album.ratingKey, y)
    // Re-date the in-memory library caches so the grid and discography strip
    // update live (the override now wins inside applyOriginalYear).
    plexState.applyOriginalYear(detail.album.ratingKey, y)
    editingYear = false
  }

  async function clearYear(): Promise<void> {
    await plexState.originalYear.clear(detail.album.ratingKey)
    // Override is gone, so revert the caches to the auto year (or Plex's if MB
    // had none). applyOriginalYear reads the now-empty override and falls back.
    plexState.applyOriginalYear(detail.album.ratingKey, autoYear ?? detail.album.year)
    editingYear = false
  }
</script>

<div class="label">album</div>
<h1>{detail.album.title}</h1>
{#if composers.length > 0}
  <div class="composer-line">
    <span class="composer-kicker">{composers.length > 1 ? 'composers' : 'composer'}</span>
    {#each composers as c, i (c.mbid)}
      {#if i > 0}<span class="c-sep">·</span>{/if}
      <button
        class="composer-link"
        onclick={() => void plexState.openEntity(c.mbid, c.name)}
        title={`Open ${c.name}`}
      >{c.name}</button>
    {/each}
    {#if composerIsOverride}
      <button
        class="composer-mini"
        onclick={openComposerPicker}
        title="Change pinned composer"
        aria-label="Change pinned composer">✎</button>
      <button
        class="composer-mini"
        onclick={() => void plexState.composerOverride.clear(detail.album.ratingKey)}
        title="Remove pinned composer"
        aria-label="Remove pinned composer">✕</button>
    {/if}
  </div>
{:else if canPinComposer && composerGuess}
  <div class="composer-line composer-guess">
    <span class="composer-kicker">suggested composer</span>
    <button
      class="composer-link"
      onclick={() => void plexState.openEntity(composerGuess!.mbid, composerGuess!.name)}
      title={composerGuess.disambiguation ?? 'Person match from MusicBrainz'}
    >{composerGuess.name}</button>
    <button class="composer-mini" onclick={openComposerPicker} aria-label="Edit composer suggestion">✎</button>
  </div>
{:else if canPinComposer}
  <button class="composer-pin" onclick={openComposerPicker}>find composer</button>
{/if}
{#if pickingComposer}
  <div class="composer-picker">
    <span class="cp-label">Composer</span>
    <input
      class="cp-input"
      type="text"
      bind:this={composerInput}
      bind:value={composerDraft}
      placeholder="e.g. Ludwig van Beethoven"
      oninput={() => (composerError = '')}
      onkeydown={(e) => {
        if (e.key === 'Enter') void saveComposer()
        else if (e.key === 'Escape') pickingComposer = false
      }}
    />
    <button class="cp-btn cp-save" disabled={composerSaving} onclick={() => void saveComposer()}
      >{composerSaving ? 'Matching…' : 'Pin'}</button>
    <button class="cp-btn cp-cancel" onclick={() => (pickingComposer = false)}>Cancel</button>
    {#if composerError}<span class="cp-error">{composerError}</span>{/if}
  </div>
{/if}
<div class="sub">
  {#if programPerformers.length > 0}
    {#each programPerformers as performer, i (performer.mbid)}
      {#if i > 0}<span class="t-sep">, </span>{/if}
      <button class="artist-link" onclick={() => void plexState.openEntity(performer.mbid, performer.name)} title={`Open ${performer.name}`}>{performer.name}</button>
    {/each}
  {:else}
    <button class="artist-link" onclick={() => void plexState.openArtistFromAlbum(detail)} title="Open artist">{detail.album.artist}</button>
  {/if}
  {#if displayYear}
    <span class="dot">·</span>
    <button
      class="year-link"
      onclick={() => plexState.openYearEntity(displayYear)}
      title={`all ${displayYear} albums in your library`}
    >{displayYear}</button>
    {#if detail.album.year && detail.album.year !== displayYear}
      <span class="reissue">· {detail.album.year} edition</span>
    {/if}
  {:else if detail.album.year}
    <span class="dot">·</span>
    <button
      class="year-link"
      onclick={() => {
        if (detail.album.year != null) plexState.openYearEntity(detail.album.year)
      }}
      title={`all ${detail.album.year} albums in your library`}
    >{detail.album.year}</button>
  {/if}
  <button
    class="edit-year"
    class:pinned={hasYearOverride}
    onclick={openYearEditor}
    title={hasYearOverride ? 'Original year is manually set — click to edit' : 'Set the original release year'}
    aria-label="Edit original release year"
  >
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
    </svg>
  </button>
  {#if detail.tracks.length > 0}
    <span class="dot">·</span>
    <span>{detail.tracks.length} track{detail.tracks.length === 1 ? '' : 's'}</span>
  {/if}
  {#if detail.genres.length > 0}
    <span class="dot">·</span>
    <span class="genres">
      {#each detail.genres as g, i (g)}
        <button
          class="genre-link"
          onclick={() => plexState.openGenreEntity(g)}
          title={`all ${g} albums in your library`}
        >{g}</button>{#if i < detail.genres.length - 1}<span class="g-sep">, </span>{/if}
      {/each}
    </span>
  {/if}
</div>

{#if editingYear}
  <div class="year-editor">
    <span class="ye-label">Original release year</span>
    <input
      class="ye-input"
      type="text"
      inputmode="numeric"
      maxlength="4"
      bind:this={yearInput}
      bind:value={yearDraft}
      placeholder="1957"
      oninput={() => (yearError = '')}
      onkeydown={(e) => {
        if (e.key === 'Enter') void saveYear()
        else if (e.key === 'Escape') editingYear = false
      }}
    />
    <button class="ye-btn ye-save" onclick={() => void saveYear()}>Save</button>
    {#if hasYearOverride}
      <button class="ye-btn ye-clear" onclick={() => void clearYear()}>Clear</button>
    {/if}
    <button class="ye-btn ye-cancel" onclick={() => (editingYear = false)}>Cancel</button>
    {#if yearError}<span class="ye-error">{yearError}</span>{/if}
  </div>
{/if}

{#if chips.length > 0}
  <div class="edition-row">
    {#each chips as chip (chip)}
      <span class="edition-chip">{chip}</span>
    {/each}
  </div>
{/if}

{@render afterChips?.()}

{#if stats.length > 0}
  <div class="stats-row">
    {#each stats as part, i (i)}
      {#if i > 0}<span class="dot">·</span>{/if}
      <span>{part}</span>
    {/each}
  </div>
{/if}

<div class="album-actions">
  <button class="play-album" onclick={playAlbum} disabled={!canCast || castBusy}>
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <polygon points="6 4 20 12 6 20 6 4"></polygon>
    </svg>
    <span>{castBusy ? 'Sending…' : !canCast ? 'Pick a player' : 'Play Album'}</span>
  </button>
  {#if canCast && !castBusy && activeName}
    <span class="play-target">on {activeName}</span>
  {/if}
</div>

{#if hasPlexSummary}
  <p class="summary">
    {#each summaryTokens as tok, i (i)}
      {#if tok.type === 'link'}
        <button
          class="name-link"
          onclick={() => void plexState.openEntity(tok.mbid, tok.name)}
          title={`Open ${tok.name}`}
        >{tok.text}</button>
      {:else}{tok.text}{/if}
    {/each}
  </p>
{:else if bio}
  {@const bioHref = safeExternalHref(bio.url)}
  <p class="summary">{bio.text}</p>
  <div class="bio-attr">
    {#if bio.source === 'wikipedia'}
      from {#if bioHref}<a href={bioHref} target="_blank" rel="noreferrer">Wikipedia</a>{:else}Wikipedia{/if}
      · CC BY-SA
    {:else}
      from {#if bioHref}<a href={bioHref} target="_blank" rel="noreferrer">Last.fm</a>{:else}Last.fm{/if}
    {/if}
  </div>
{:else if bioLoading}
  <p class="summary hint-muted">looking up a description…</p>
{/if}

<style>
  .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--faded);
    margin-bottom: 0.4rem;
  }
  /* Album title is the most important word on the page. Flat espresso on a
     serif display face lets it land — the old gradient washed the bottom of
     the letterforms into the cream paper. */
  h1 {
    font-family: var(--font-display);
    font-size: clamp(1.85rem, 3.6vw, 2.8rem);
    font-weight: 700;
    letter-spacing: -0.015em;
    margin: 0;
    line-height: 1.05;
    color: var(--espresso);
  }
  .sub {
    color: var(--faded);
    font-size: 0.95rem;
    margin-top: 0.4rem;
  }
  .reissue {
    font-size: 0.8rem;
    color: var(--faded);
    margin-left: 0.3rem;
  }
  /* Composer sits between title and performer — the identity Plex hides, so
     it reads first, in the display serif, above the artist/year sub-line. */
  .composer-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  .composer-kicker {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--faded);
    align-self: center;
  }
  .composer-link {
    background: transparent;
    border: 0;
    padding: 0;
    font-family: var(--font-display, inherit);
    font-size: 1.15rem;
    font-weight: 600;
    line-height: 1.1;
    color: var(--espresso);
    cursor: pointer;
    border-bottom: 1px solid transparent;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .composer-link:hover {
    color: var(--brick);
    border-bottom-color: var(--brick);
  }
  .c-sep {
    color: var(--whisper);
    align-self: center;
  }
  .composer-mini {
    background: transparent;
    border: 0;
    padding: 0 0.15rem;
    color: var(--whisper);
    cursor: pointer;
    font-size: 0.8rem;
    align-self: center;
    opacity: 0.55;
    transition: color 120ms ease, opacity 120ms ease;
  }
  .composer-line:hover .composer-mini {
    opacity: 1;
  }
  .composer-mini:hover {
    color: var(--brick);
  }
  .composer-pin {
    margin-top: 0.5rem;
    background: transparent;
    border: 1px dashed var(--hairline);
    color: var(--faded);
    cursor: pointer;
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.2rem 0.6rem;
    border-radius: var(--radius-pill);
    transition: color 120ms ease, border-color 120ms ease;
  }
  .composer-pin:hover {
    color: var(--brick);
    border-color: var(--brick);
  }
  .composer-picker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.5rem;
  }
  .cp-label {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.68rem;
    color: var(--faded);
  }
  .cp-input {
    flex: 1 1 14rem;
    min-width: 10rem;
    font: inherit;
    font-size: 0.9rem;
    padding: 0.28rem 0.5rem;
    color: var(--espresso);
    background: var(--inset);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
  }
  .cp-input:focus {
    outline: none;
    border-color: var(--brick);
  }
  .cp-btn {
    font: inherit;
    font-size: 0.78rem;
    padding: 0.28rem 0.7rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--hairline);
    background: var(--surface);
    color: var(--walnut);
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  .cp-save {
    background: var(--brick);
    border-color: var(--brick);
    color: var(--inset);
    font-weight: 600;
  }
  .cp-save:hover:not(:disabled) {
    background: var(--brick-deep);
  }
  .cp-save:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .cp-cancel:hover {
    border-color: var(--walnut);
    color: var(--espresso);
  }
  .cp-error {
    color: var(--brick);
    font-size: 0.78rem;
  }
  /* Pencil affordance on the year — subtle until the row is hovered, accented
     when a manual override is in effect so it reads as "this year was pinned." */
  .edit-year {
    background: transparent;
    border: 0;
    padding: 0.1rem 0.2rem;
    margin-left: 0.3rem;
    color: var(--whisper);
    cursor: pointer;
    vertical-align: middle;
    border-radius: var(--radius-sm);
    opacity: 0.55;
    transition: color 120ms ease, opacity 120ms ease, background 120ms ease;
  }
  .sub:hover .edit-year {
    opacity: 1;
  }
  .edit-year:hover {
    color: var(--brick);
    background: var(--surface);
  }
  .edit-year.pinned {
    color: var(--brick);
    opacity: 1;
  }
  .year-editor {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.5rem;
    font-size: 0.8rem;
    color: var(--faded);
  }
  .ye-label {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.68rem;
    color: var(--faded);
  }
  .ye-input {
    width: 5.5rem;
    font: inherit;
    font-size: 0.85rem;
    padding: 0.25rem 0.45rem;
    color: var(--espresso);
    background: var(--inset);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
  }
  .ye-input:focus {
    outline: none;
    border-color: var(--brick);
  }
  .ye-btn {
    font: inherit;
    font-size: 0.78rem;
    padding: 0.28rem 0.7rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--hairline);
    background: var(--surface);
    color: var(--walnut);
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  .ye-save {
    background: var(--brick);
    border-color: var(--brick);
    color: var(--inset);
    font-weight: 600;
  }
  .ye-save:hover {
    background: var(--brick-deep);
  }
  .ye-clear:hover,
  .ye-cancel:hover {
    border-color: var(--walnut);
    color: var(--espresso);
  }
  .ye-error {
    color: var(--brick);
    font-size: 0.78rem;
  }
  .dot {
    margin: 0 0.5rem;
    color: var(--whisper);
  }
  .artist-link {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--brick);
    font: inherit;
    cursor: pointer;
    border-bottom: 1px solid transparent;
  }
  .artist-link:hover {
    border-bottom-color: var(--brick);
  }
  .year-link,
  .genre-link {
    background: transparent;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    border-bottom: 1px solid transparent;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .year-link:hover {
    color: var(--ok-fg);
    border-bottom-color: var(--ok-border);
  }
  .genre-link:hover {
    color: var(--brick);
    border-bottom-color: var(--brick);
  }
  .g-sep {
    color: inherit;
  }
  .edition-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.45rem;
  }
  .edition-chip {
    display: inline-block;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--walnut);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: 0.18rem 0.55rem;
    line-height: 1.2;
  }
  .stats-row {
    color: var(--faded);
    font-size: 0.78rem;
    margin-top: 0.55rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }
  .album-actions {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    margin-top: 1.25rem;
  }
  .play-album {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    background: linear-gradient(180deg, var(--brick-deep) 0%, var(--brick) 100%);
    color: var(--inset);
    border: 0;
    padding: 0.75rem 1.5rem;
    border-radius: var(--radius-pill);
    font-size: 0.95rem;
    font-weight: 700;
    letter-spacing: 0.005em;
    cursor: pointer;
    box-shadow:
      0 8px 22px rgba(140, 53, 34, 0.28),
      inset 0 1px 0 rgba(43, 29, 18, 0.18);
    transition: background 140ms ease, transform 120ms ease, box-shadow 140ms ease;
  }
  .play-album:not(:disabled):hover {
    transform: translateY(-1px);
    box-shadow:
      0 12px 28px rgba(140, 53, 34, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.24);
  }
  .play-album:not(:disabled):active {
    transform: translateY(0) scale(0.98);
  }
  .play-album:focus-visible {
    outline: 2px solid var(--brick);
    outline-offset: 3px;
  }
  .play-album:disabled {
    background: var(--ink-tint-04);
    color: var(--faded);
    border: 1px solid var(--ink-tint-06);
    cursor: default;
    box-shadow: none;
  }
  .play-target {
    color: var(--faded);
    font-size: 0.8rem;
  }
  .summary {
    margin: 1.25rem 0 0;
    color: var(--espresso);
    font-size: 0.92rem;
    line-height: 1.55;
    max-width: 58ch;
    white-space: pre-wrap;
  }
  .summary.hint-muted {
    color: var(--faded);
    font-style: italic;
  }
  .bio-attr {
    margin-top: 0.4rem;
    font-size: 0.72rem;
    color: var(--faded);
  }
  .bio-attr a {
    color: var(--faded);
    text-decoration: none;
    border-bottom: 1px dotted var(--hairline);
  }
  .bio-attr a:hover {
    color: var(--brick);
    border-bottom-color: var(--brick);
  }
  .name-link {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--brick);
    font: inherit;
    cursor: pointer;
    border-bottom: 1px solid transparent;
  }
  .name-link:hover {
    border-bottom-color: var(--brick);
  }
</style>
