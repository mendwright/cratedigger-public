<script lang="ts">
  import type { ShowRow } from '../../../shared/plex'
  import { isMarked, orderShowRows } from '../lib/shows-controller.svelte'
  import { plexState } from '../lib/plex-state.svelte'
  import BackButton from '../lib/BackButton.svelte'
  import { PUBLIC_BUILD } from '../../../shared/build-flags'

  const rows = $derived(plexState.shows.rows)
  const loading = $derived(plexState.shows.loading)
  const progress = $derived(plexState.shows.progress)
  const error = $derived(plexState.shows.error)
  const venueErrors = $derived(plexState.shows.venueErrors)
  const recentNewIds = $derived(plexState.shows.recentNewIds)
  const marks = $derived(plexState.shows.marks)
  // Marked rows (pinned / tickets bought) float to the top; pinning a row
  // re-sorts live since this derives from rows + marks together.
  const ordered = $derived(orderShowRows(rows, marks))

  // Venue filter chips: one per venue actually present in the results, with
  // a count. Empty selection = all venues.
  const venueFilter = $derived(plexState.shows.venueFilter)
  const venueOptions = $derived.by(() => {
    const counts = new Map<string, { name: string; count: number }>()
    for (const r of rows) {
      const cur = counts.get(r.venue.id)
      if (cur) cur.count += 1
      else counts.set(r.venue.id, { name: r.venue.name, count: 1 })
    }
    return [...counts.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })
  const visible = $derived(
    venueFilter.length === 0
      ? ordered
      : ordered.filter((r) => venueFilter.includes(r.venue.id))
  )

  let listEl = $state<HTMLUListElement | null>(null)

  function isNew(row: ShowRow): boolean {
    return row.ownedAlbumCount > 0 && recentNewIds.includes(row.event.id)
  }

  function tickets(row: ShowRow): number {
    return marks[row.event.id]?.tickets ?? 0
  }

  function isPinned(row: ShowRow): boolean {
    return marks[row.event.id]?.pinned ?? false
  }

  // Arriving from a notification / banner click: scroll the first
  // just-announced row into view once it renders. Rows stream in per venue, so
  // re-check on every rows change until one shows up.
  $effect(() => {
    if (!plexState.shows.scrollToNewPending) return
    void rows
    const el = listEl?.querySelector('li.is-new')
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      plexState.shows.scrollToNewPending = false
    }
  })

  function fmtDate(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
    if (!m) return iso
    const date = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)))
    const weekday = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
    const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    return `${weekday} · ${day}`
  }

  function billing(row: ShowRow): string {
    if (row.event.supportArtists.length === 0) return row.event.artistName
    return `${row.event.artistName} · ${row.event.supportArtists.join(', ')}`
  }

  function onRowContextMenu(e: MouseEvent, row: ShowRow): void {
    e.preventDefault()
    const items: { label: string; onClick: () => void; disabled?: boolean }[] = []
    items.push({
      label: isPinned(row) ? 'Unpin show' : 'Pin show',
      onClick: () => plexState.shows.togglePin(row)
    })
    items.push({
      label: 'Bought a ticket (+1)',
      onClick: () => plexState.shows.adjustTickets(row, 1)
    })
    if (tickets(row) > 0) {
      items.push({
        label: 'Remove a ticket (−1)',
        onClick: () => plexState.shows.adjustTickets(row, -1)
      })
    }
    if (row.event.url) {
      items.push({
        label: 'Open tickets in browser pane',
        onClick: () => plexState.openBrowserPaneAt(row.event.url)
      })
      items.push({
        label: 'Open tickets in real browser',
        onClick: () => {
          try {
            window.open(row.event.url, '_blank', 'noopener,noreferrer')
          } catch {
            // popup blocker; user can try the pane action instead
          }
        }
      })
    }
    if (row.plexArtistRatingKey && row.matchedArtistName) {
      items.push({
        label: `Open ${row.matchedArtistName} in Cratedigger`,
        onClick: () =>
          void plexState.openEntity(row.plexArtistRatingKey!, row.matchedArtistName!)
      })
    }
    if (!PUBLIC_BUILD) {
      items.push({
        label: `Search Soulseek for ${row.event.artistName}`,
        onClick: () =>
          plexState.slskd.searchSoulseekFor(row.event.artistName, row.event.artistName)
      })
    }
    if (items.length > 0) {
      plexState.openContextMenu(e.clientX, e.clientY, items)
    }
  }
</script>

<div class="page">
  <header class="head">
    <div class="title-row">
      <BackButton onclick={() => plexState.closeShows()} />
      <div>
        <h1>Shows in SF</h1>
        <div class="sub">
          Hand-picked Bay Area venues · library matches highlighted
        </div>
      </div>
    </div>
    <div class="actions">
      <button
        class="primary"
        disabled={loading}
        onclick={() => void plexState.shows.run()}
      >
        {loading ? 'Looking up…' : rows.length === 0 ? 'Find shows' : 'Refresh'}
      </button>
    </div>
  </header>

  {#if loading && progress.total > 0}
    <div class="progress">
      <div class="bar"><div class="fill" style="width: {(progress.done / progress.total) * 100}%"></div></div>
      <div class="prog-text">
        {progress.done} / {progress.total} venues
        {#if progress.current}<span class="prog-current"> · {progress.current}</span>{/if}
      </div>
    </div>
  {/if}

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if !loading && rows.length === 0 && !error}
    <p class="hint">
      Click <strong>Find shows</strong> to scan venue calendars.
    </p>
  {/if}

  {#if venueOptions.length > 1}
    <div class="venue-filter" role="group" aria-label="Filter by venue">
      <button
        class="vchip"
        class:active={venueFilter.length === 0}
        onclick={() => plexState.shows.clearVenueFilter()}
      >all venues</button>
      {#each venueOptions as v (v.id)}
        <button
          class="vchip"
          class:active={venueFilter.includes(v.id)}
          onclick={() => plexState.shows.toggleVenueFilter(v.id)}
        >{v.name} <span class="vcount">{v.count}</span></button>
      {/each}
    </div>
  {/if}

  {#if rows.length > 0 && visible.length === 0}
    <p class="hint">No shows at the selected venues.</p>
  {/if}

  {#if rows.length > 0}
    <ul class="rows" bind:this={listEl}>
      {#each visible as row (row.event.id)}
        <li
          class:owned={row.ownedAlbumCount > 0}
          class:is-new={isNew(row)}
          class:is-marked={isMarked(marks[row.event.id])}
          oncontextmenu={(e) => onRowContextMenu(e, row)}
          ondblclick={() => row.event.url && plexState.openBrowserPaneAt(row.event.url)}
        >
          <div class="date">{fmtDate(row.event.date)}</div>
          <div class="main">
            <div class="artist">
              <button
                type="button"
                class="artist-link"
                title={`Open ${row.event.artistName}`}
                onclick={(e) => {
                  e.stopPropagation()
                  // Local fast-path: if we matched this row against the library
                  // and Plex has the artist's MBID, open the entity page
                  // directly with no MusicBrainz roundtrip. Falls back to the
                  // MB search (cached after first hit) otherwise.
                  if (row.plexArtistMbid && row.matchedArtistName) {
                    void plexState.openEntity(row.plexArtistMbid, row.matchedArtistName)
                  } else {
                    void plexState.openSearchArtist(row.event.artistName)
                  }
                }}
              >{row.event.artistName}</button>
              {#if row.ownedAlbumCount > 0}
                <span class="owned-chip" title={row.matchedArtistName ? `Matched on ${row.matchedArtistName}` : ''}>
                  {row.ownedAlbumCount} owned
                </span>
              {/if}
              {#if isNew(row)}
                <!-- Name the matched artist when they're not the headliner —
                     the notification said "Greg Mendez announced a show", so
                     the badge has to be findable by that name even when he's
                     third on someone else's bill. -->
                <span class="new-chip">
                  just announced{row.matchedArtistName &&
                  row.matchedArtistName !== row.event.artistName
                    ? ` · ${row.matchedArtistName}`
                    : ''}
                </span>
              {/if}
            </div>
            {#if row.event.supportArtists.length > 0}
              <div class="supports">
                with{' '}
                {#each row.event.supportArtists as sa, i (sa + i)}
                  {#if i > 0}<span class="sep">, </span>{/if}
                  <button
                    type="button"
                    class="support-link"
                    title={`Open ${sa}`}
                    onclick={(e) => {
                      e.stopPropagation()
                      void plexState.openSearchArtist(sa)
                    }}
                  >{sa}</button>
                {/each}
              </div>
            {/if}
            <div class="venue">{row.venue.name}</div>
          </div>
          <div class="trailing">
            {#if tickets(row) > 0}
              <div class="ticket-stepper" title="tickets bought">
                <button
                  class="step"
                  aria-label="one fewer ticket"
                  onclick={() => plexState.shows.adjustTickets(row, -1)}
                >−</button>
                <span class="ticket-count">🎟 {tickets(row)}</span>
                <button
                  class="step"
                  aria-label="one more ticket"
                  onclick={() => plexState.shows.adjustTickets(row, 1)}
                >+</button>
              </div>
            {:else}
              <button
                class="ghost-action"
                title="Bought a ticket"
                onclick={() => plexState.shows.adjustTickets(row, 1)}
              >+ 🎟</button>
            {/if}
            <button
              class="pin"
              class:pinned={isPinned(row)}
              title={isPinned(row) ? 'Unpin' : 'Pin — keep an eye on this show'}
              aria-label={isPinned(row) ? 'Unpin show' : 'Pin show'}
              onclick={() => plexState.shows.togglePin(row)}
            >
              <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
                <path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5c0 .276-.224 1.5-.5 1.5s-.5-1.224-.5-1.5V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189A6 6 0 0 1 5 6.708V2.277a3 3 0 0 1-.354-.298C4.342 1.674 4 1.18 4 .5a.5.5 0 0 1 .146-.354"/>
              </svg>
            </button>
            {#if row.event.url}
              <button
                class="tickets"
                onclick={() => plexState.openBrowserPaneAt(row.event.url)}
                title="Open in the in-app browser pane"
              >tickets ↗</button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if venueErrors.length > 0 && !loading}
    <details class="venue-errors">
      <summary>{venueErrors.length} {venueErrors.length === 1 ? 'venue' : 'venues'} couldn't be reached</summary>
      <ul>
        {#each venueErrors as ve (ve.venueName)}
          <li><strong>{ve.venueName}</strong> — {ve.message}</li>
        {/each}
      </ul>
    </details>
  {/if}
</div>

<style>
  .page {
    height: 100%;
    overflow: auto;
    padding: 1.25rem 1.5rem 4rem;
    background: var(--paper);
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 1.25rem;
    gap: 1rem;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  h1 {
    font-size: 1.6rem;
    margin: 0;
    color: var(--espresso);
  }
  .sub {
    font-size: 0.78rem;
    color: var(--faded);
  }
  .primary {
    background: var(--brick);
    border: none;
    color: #fff;
    padding: 0.5rem 1rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.85rem;
  }
  .primary:disabled { opacity: 0.6; cursor: default; }
  .progress { margin-bottom: 1rem; }
  .progress .bar {
    height: 4px;
    background: var(--surface);
    border-radius: var(--radius-xs);
    overflow: hidden;
  }
  .progress .fill {
    height: 100%;
    background: var(--brick);
    transition: width 200ms ease;
  }
  .prog-text {
    margin-top: 0.35rem;
    font-size: 0.72rem;
    color: var(--faded);
  }
  .prog-current { color: var(--walnut); }
  .hint {
    color: var(--faded);
    font-size: 0.92rem;
    padding: 2rem 0;
    text-align: center;
  }
  .error {
    color: var(--err-fg);
    background: var(--warn-bg);
    border: 1px solid var(--warn-border);
    padding: 0.6rem 0.9rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
  }
  .venue-errors {
    margin-top: 2rem;
    font-size: 0.72rem;
    color: var(--faded);
    opacity: 0.7;
  }
  .venue-errors summary { cursor: pointer; }
  .venue-errors ul { margin: 0.4rem 0 0 1rem; padding: 0; }
  .venue-errors li { padding: 0.15rem 0; }
  .rows {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
  }
  .rows li {
    display: grid;
    grid-template-columns: 120px 1fr auto;
    gap: 1rem;
    padding: 0.85rem 0.5rem;
    border-bottom: 1px solid var(--hairline);
    align-items: center;
    transition: background 100ms ease;
  }
  .rows li:hover {
    background: var(--surface);
  }
  .rows li.owned .artist {
    font-weight: 600;
  }
  .date {
    font-size: 0.85rem;
    color: var(--walnut);
    font-variant-numeric: tabular-nums;
  }
  .artist {
    font-size: 1rem;
    color: var(--espresso);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  /* Button reset so the headliner reads as the row's primary text, not a
     control — underline only appears on hover/focus so the resting layout
     stays clean. Inherits font-weight from .rows li.owned for the bold
     treatment on owned rows. */
  .artist-link {
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .artist-link:hover,
  .artist-link:focus-visible {
    text-decoration: underline;
    text-decoration-color: var(--brick);
    text-underline-offset: 3px;
    outline: none;
  }
  .supports {
    font-size: 0.78rem;
    color: var(--walnut);
    margin-top: 0.1rem;
  }
  .support-link {
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .support-link:hover,
  .support-link:focus-visible {
    text-decoration: underline;
    text-decoration-color: var(--brick);
    text-underline-offset: 2px;
    color: var(--espresso);
    outline: none;
  }
  .sep { color: var(--faded); }
  .owned-chip {
    background: var(--brick-wash);
    color: var(--brick);
    font-size: 0.7rem;
    padding: 0.12rem 0.5rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--brick);
    font-weight: 600;
  }
  .new-chip {
    background: var(--brick);
    color: #fff;
    font-size: 0.7rem;
    padding: 0.12rem 0.5rem;
    border-radius: var(--radius-pill);
    font-weight: 600;
    white-space: nowrap;
  }
  /* Just-announced rows get a brick left edge so the eye lands on them even
     mid-scroll. */
  .rows li.is-new {
    box-shadow: inset 3px 0 0 var(--brick);
    background: var(--brick-wash);
  }
  .venue {
    font-size: 0.78rem;
    color: var(--faded);
    margin-top: 0.15rem;
  }
  .tickets {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--walnut);
    padding: 0.32rem 0.8rem;
    border-radius: var(--radius-pill);
    font-size: 0.75rem;
    cursor: pointer;
    transition: background 120ms, color 120ms, border-color 120ms;
  }
  .tickets:hover {
    background: var(--surface);
    color: var(--espresso);
    border-color: var(--walnut);
  }
  .trailing {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .venue-filter {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 1rem;
  }
  .vchip {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--walnut);
    padding: 0.28rem 0.7rem;
    border-radius: var(--radius-pill);
    font-size: 0.75rem;
    cursor: pointer;
    white-space: nowrap;
    transition: background 120ms, color 120ms, border-color 120ms;
  }
  .vchip:hover {
    background: var(--surface);
    color: var(--espresso);
    border-color: var(--walnut);
  }
  .vchip.active {
    background: var(--brick-wash);
    border-color: var(--brick);
    color: var(--brick);
    font-weight: 600;
  }
  .vcount {
    opacity: 0.65;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }
  /* Marked rows (pinned / tickets bought) get a walnut left edge — distinct
     from the brick edge "just announced" uses. */
  .rows li.is-marked {
    box-shadow: inset 3px 0 0 var(--walnut);
  }
  .pin {
    background: transparent;
    border: 1px solid transparent;
    color: var(--faded);
    padding: 0.3rem 0.45rem;
    border-radius: var(--radius-pill);
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms, color 120ms, background 120ms;
    line-height: 0;
  }
  .rows li:hover .pin,
  .pin:focus-visible {
    opacity: 1;
  }
  .pin.pinned {
    opacity: 1;
    color: var(--brick);
  }
  .pin:hover {
    background: var(--surface);
    color: var(--espresso);
  }
  .pin.pinned:hover { color: var(--brick); }
  /* Hover-revealed "+ 🎟" — same ghost treatment as the pin. */
  .ghost-action {
    background: transparent;
    border: 1px solid var(--hairline);
    color: var(--walnut);
    padding: 0.28rem 0.6rem;
    border-radius: var(--radius-pill);
    font-size: 0.72rem;
    cursor: pointer;
    opacity: 0;
    white-space: nowrap;
    transition: opacity 120ms, background 120ms, color 120ms;
  }
  .rows li:hover .ghost-action,
  .ghost-action:focus-visible {
    opacity: 1;
  }
  .ghost-action:hover {
    background: var(--surface);
    color: var(--espresso);
  }
  .ticket-stepper {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    border: 1px solid var(--brick);
    background: var(--brick-wash);
    border-radius: var(--radius-pill);
    padding: 0.1rem 0.25rem;
  }
  .ticket-count {
    color: var(--brick);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0 0.15rem;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .ticket-stepper .step {
    background: transparent;
    border: 0;
    color: var(--brick);
    font-size: 0.85rem;
    width: 1.2rem;
    height: 1.2rem;
    line-height: 1;
    border-radius: var(--radius-pill);
    cursor: pointer;
    opacity: 0.55;
    transition: opacity 100ms, background 100ms;
  }
  .ticket-stepper .step:hover {
    opacity: 1;
    background: var(--surface);
  }
</style>
