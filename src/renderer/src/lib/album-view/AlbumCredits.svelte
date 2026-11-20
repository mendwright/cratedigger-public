<script lang="ts">
  import type { AlbumCredits, AlbumDetail } from '../../../../shared/plex'
  import { plexState } from '../plex-state.svelte'
  import { groupCredits, groupCreditsByPerson, type PersonCredit } from './helpers'

  // The credits section, identical on album-detail and now-playing. Two views:
  // by person (default) — one row per player with every role they held and how
  // many of your other records they're on — and the older by-role wall, kept
  // for "who played pedal steel?". Its only other actions are the two
  // MusicBrainz-match controls.
  let {
    detail,
    credits,
    creditsLoading,
    creditsError,
    matchControls = true
  }: {
    detail: AlbumDetail
    credits: AlbumCredits | null
    creditsLoading: boolean
    creditsError: string | null
    // Album detail moves match / reset into its album menu; Now Playing has no
    // such menu and keeps them here.
    matchControls?: boolean
  } = $props()
  const openMatch = (): void =>
    plexState.manualMatch.open(detail.album.ratingKey, detail.album.artist, detail.album.title)

  const VIEW_KEY = 'cratedigger:credits-view'
  const SHOWN = 8
  let view = $state<'person' | 'role'>(
    (() => {
      try {
        return localStorage.getItem(VIEW_KEY) === 'role' ? 'role' : 'person'
      } catch {
        return 'person'
      }
    })()
  )
  function setView(v: 'person' | 'role'): void {
    view = v
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // Private storage unavailable — the choice lasts for this session only.
    }
  }

  const grouped = $derived(groupCredits(credits, detail.tracks))
  const people = $derived(
    groupCreditsByPerson(credits, detail.tracks, { name: detail.album.artist })
  )
  const leads = $derived(people.filter((p) => p.isAlbumArtist))
  // Players who lead somewhere in your collection come first: most other
  // records of yours, then most tracks here (the order people arrives in —
  // the sort is stable). Placeholders stay last. Counts arrive a beat after
  // the credits, so the list settles once when they land.
  const players = $derived(
    people
      .filter((p) => !p.isAlbumArtist)
      .sort(
        (a, b) =>
          Number(a.placeholder) - Number(b.placeholder) ||
          (libCounts[b.mbid] ?? 0) - (libCounts[a.mbid] ?? 0)
      )
  )
  let showAll = $state(false)
  $effect(() => {
    void detail.album.ratingKey
    showAll = false
  })
  const visiblePlayers = $derived(showAll ? players : players.slice(0, SHOWN))

  // "on N of your records": distinct library albums crediting each person,
  // excluding this one, from the main-process credit index. Fills in as the
  // library warmer credits more of the library.
  let libCounts = $state<Record<string, number>>({})
  $effect(() => {
    const rk = detail.album.ratingKey
    const mbids = people.filter((p) => !p.placeholder).map((p) => p.mbid)
    libCounts = {}
    if (mbids.length === 0) return
    let live = true
    void window.cratedigger.plex
      .getLibraryCreditCounts({ mbids, excludeRatingKey: rk })
      .then((counts) => {
        if (live) libCounts = counts
      })
      .catch(() => {
        // Index unavailable — rows simply show no counts.
      })
    return () => {
      live = false
    }
  })

  const total = $derived(detail.tracks.length)
  // "(You're Gonna Miss Me)" for a guest or a cover; "(11 tracks)" once the
  // list would be longer than the name. Album-wide credits get nothing.
  function onLabel(titles: string[]): string {
    // Slash-joined: song titles carry their own commas ("Hold On, Hold On").
    return titles.length <= 3 ? titles.join(' / ') : `${titles.length} tracks`
  }
  function scope(p: PersonCredit): string {
    if (p.onTracks) return onLabel(p.onTracks)
    return total > 1 && p.trackCount >= total ? 'all tracks' : ''
  }
</script>

<div class="credits-slot" data-personnel>
  <div class="credits-head">
    <div class="label">credits</div>
    <div class="credits-actions">
      {#if people.length > 0}
        <div class="view-toggle" role="group" aria-label="Arrange credits">
          <button
            class:on={view === 'person'}
            aria-pressed={view === 'person'}
            onclick={() => setView('person')}
          >by person</button>
          <button
            class:on={view === 'role'}
            aria-pressed={view === 'role'}
            onclick={() => setView('role')}
          >by role</button>
        </div>
      {/if}
      {#if matchControls}
        <button class="match-btn" onclick={openMatch}>match on musicbrainz</button>
        <button
          class="match-btn subtle"
          onclick={() => void plexState.manualMatch.clearMatch(detail.album.ratingKey)}
          title="Reset to automatic match"
        >reset</button>
      {/if}
    </div>
  </div>
  {#if creditsLoading}
    <p class="hint">looking up on musicbrainz…</p>
  {:else if creditsError}
    <p class="hint">{creditsError}</p>
  {:else if grouped.length === 0}
    <p class="hint">
      MusicBrainz has no credits for this release.
      <button class="inline-link" onclick={openMatch}>Pick the right release</button>
    </p>
  {:else if view === 'person'}
    {#snippet personRow(p: PersonCredit, lead: boolean)}
      {@const count = libCounts[p.mbid] ?? 0}
      {@const where = scope(p)}
      <li class="person-row" class:lead>
        <div class="who">
          {#if p.placeholder}
            <span class="person-name placeholder">{p.name.slice(1, -1)}</span>
          {:else}
            <button
              class="person-name"
              onclick={() => void plexState.openEntity(p.mbid, p.name)}
              title={`Open ${p.name}`}
            >{p.name}</button>
          {/if}
          {#if count > 0}
            <span
              class="lib-count"
              title={`Credited on ${count} other ${count === 1 ? 'record' : 'records'} in your library`}
            >on {count} of yours</span>
          {/if}
        </div>
        <div class="what">
          <span class="roles">{p.roles.join(', ')}</span>{#if where}{' · '}<span class="where"
              title={p.onTracks ? p.onTracks.join(' / ') : undefined}>{where}</span
            >{/if}
        </div>
      </li>
    {/snippet}
    <ul class="people-list">
      {#each leads as p (p.mbid)}{@render personRow(p, true)}{/each}
      {#each visiblePlayers as p (p.mbid)}{@render personRow(p, false)}{/each}
    </ul>
    {#if players.length > SHOWN}
      <button class="more-toggle" aria-expanded={showAll} onclick={() => (showAll = !showAll)}
        >{showAll ? 'fewer credits' : `all credits (${people.length})`}</button
      >
    {/if}
  {:else}
    <ul class="credit-groups">
      {#each grouped as g (g.role + '::' + g.label)}
        <li>
          <div class="role">{g.label}</div>
          <div class="people">
            {#each [...g.people.entries()] as [mbid, name] (mbid)}
              {@const on = g.onTracks.get(mbid)}
              <button
                class="person"
                onclick={() => void plexState.openEntity(mbid, name)}
                title={on ? `${name} — ${g.label}: ${on.join(' / ')}` : undefined}
              >{name}{#if on}<span class="on">{' ('}{onLabel(on)})</span>{/if}</button>
            {/each}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .credits-slot {
    margin-top: 2.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--ink-tint-04);
  }
  .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--faded);
    margin-bottom: 0.4rem;
  }
  .credits-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .credits-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .credits-actions .match-btn {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--faded);
    font-size: 0.72rem;
    padding: 0.25rem 0.7rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
  }
  .credits-actions .match-btn:hover {
    border-color: var(--brick);
    color: var(--brick-ink);
  }
  .credits-actions .match-btn.subtle,
  .credits-actions .match-btn.subtle:hover {
    color: var(--faded);
    border-color: var(--hairline);
  }
  .view-toggle {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    background: var(--ink-tint-06);
    border-radius: var(--radius-pill);
  }
  .view-toggle button {
    background: transparent;
    border: 0;
    color: var(--walnut);
    font-size: 0.72rem;
    padding: 0.22rem 0.65rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: color var(--dur-instant) var(--ease-out), background var(--dur-instant) var(--ease-out);
  }
  .view-toggle button:hover {
    color: var(--espresso);
  }
  .view-toggle button.on {
    background: var(--ink-tint-12);
    color: var(--espresso);
    font-weight: 600;
  }
  .people-list {
    list-style: none;
    padding: 0;
    margin: 0.9rem 0 0;
    display: flex;
    flex-direction: column;
  }
  .person-row {
    display: grid;
    grid-template-columns: minmax(11rem, 15rem) 1fr;
    gap: 0.25rem 1.25rem;
    align-items: baseline;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--ink-tint-04);
  }
  .person-row.lead {
    padding-bottom: 0.8rem;
    margin-bottom: 0.2rem;
    border-bottom-color: var(--hairline);
  }
  .who {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.2rem 0.55rem;
    min-width: 0;
  }
  /* Futura For Names: people are names of things, so they get the display
     face — the credit graph is the reason this app exists. */
  .person-name {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--espresso);
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    border-bottom: 1px solid transparent;
    transition: color var(--dur-instant) var(--ease-out), border-color var(--dur-instant) var(--ease-out);
  }
  .person-name.placeholder {
    color: var(--faded);
    font-style: italic;
    cursor: default;
  }
  .person-name:not(.placeholder):hover {
    color: var(--brick-ink);
    border-bottom-color: var(--brick-ink);
  }
  /* Teal supports: a quiet "this name leads somewhere you own". */
  .lib-count {
    font-size: 0.7rem;
    color: var(--crate-teal);
    white-space: nowrap;
  }
  .what {
    color: var(--walnut);
    font-size: 0.85rem;
    line-height: 1.45;
    min-width: 0;
  }
  .where {
    color: var(--faded);
    white-space: nowrap;
  }
  .more-toggle {
    margin-top: 0.7rem;
    padding: 0.15rem 0;
    background: transparent;
    border: 0;
    border-bottom: 1px dotted var(--hairline-strong);
    color: var(--walnut);
    font-size: 0.8rem;
    cursor: pointer;
  }
  .more-toggle:hover {
    color: var(--brick-ink);
    border-bottom-color: var(--brick-ink);
  }
  @media (max-width: 900px) {
    .person-row {
      grid-template-columns: 1fr;
    }
  }
  .credit-groups {
    list-style: none;
    padding: 0;
    margin: 0.75rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .credit-groups li {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }
  .role {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--faded);
    min-width: 120px;
    padding-top: 0.25rem;
    flex-shrink: 0;
  }
  .people {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.5rem;
  }
  .person {
    background: var(--ink-tint-04);
    border: 1px solid var(--ink-tint-08);
    color: var(--espresso);
    font-size: 0.82rem;
    padding: 0.25rem 0.7rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: border-color 140ms ease, color 140ms ease, background 140ms ease, transform 80ms ease;
  }
  .person:hover {
    border-color: color-mix(in srgb, var(--brick) 50%, transparent);
    color: var(--brick-ink);
    background: var(--brick-wash);
  }
  .person:active {
    transform: scale(0.97);
  }
  .on {
    color: var(--faded);
    font-size: 0.86em;
  }
  .inline-link {
    background: transparent;
    border: 0;
    border-bottom: 1px dotted var(--hairline-strong);
    padding: 0;
    margin-left: 0.3rem;
    color: var(--walnut);
    font-size: inherit;
    cursor: pointer;
  }
  .inline-link:hover {
    color: var(--brick-ink);
    border-bottom-color: var(--brick-ink);
  }
  .hint {
    color: var(--faded);
    font-size: 0.85rem;
    margin: 0;
  }
</style>
