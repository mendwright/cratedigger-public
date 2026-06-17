<script lang="ts">
  import { canonicalArtistKey } from '../../../../shared/artist-aliases'
  import type { ShowRow } from '../../../../shared/plex'
  import { plexState } from '../plex-state.svelte'
  import { showsForArtist } from '../shows-controller.svelte'

  // "Playing near you" — upcoming tracked-venue shows where this artist is on the
  // bill. Self-contained so it can drop into any artist-scoped view (Now Playing,
  // Album Detail, the Entity/artist page) without each screen re-deriving the
  // same logic. Renders nothing when the artist has no upcoming local shows
  // (the common case).
  let { artistName }: { artistName: string | null | undefined } = $props()

  // Lazy-load the shows list the first time any view mounts this callout, so it
  // lights up without the user having visited the Shows screen. ensureFresh()
  // no-ops if rows are already loaded or a scan is in flight, so this is cheap
  // across the many places it now appears.
  $effect(() => {
    if (artistName) plexState.shows.ensureFresh()
  })

  const upcoming = $derived(
    showsForArtist(plexState.shows.rows, artistName, new Date().toISOString().slice(0, 10))
  )

  function showDate(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
    if (!m) return iso
    const date = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)))
    const weekday = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
    const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    return `${weekday} · ${day}`
  }

  // When this artist isn't the headliner, name who they're opening for so the
  // callout reads honestly ("supporting …") rather than implying top billing.
  function supportLine(row: ShowRow): string {
    const key = canonicalArtistKey(artistName ?? '')
    if (canonicalArtistKey(row.event.artistName) === key) {
      return row.event.supportArtists.length ? `with ${row.event.supportArtists.join(', ')}` : ''
    }
    return `supporting ${row.event.artistName}`
  }

  function openShow(row: ShowRow): void {
    if (row.event.url) plexState.openBrowserPaneAt(row.event.url)
  }

  function openShowsScreen(): void {
    plexState.closeNowPlaying()
    void plexState.openShows()
  }
</script>

{#if upcoming.length > 0}
  <section class="np-shows" aria-label="Upcoming shows">
    <div class="np-shows-head">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4Z"></path>
        <path d="M13 5v2M13 11v2M13 17v2"></path>
      </svg>
      <span>Playing near you</span>
    </div>
    <div class="np-shows-list">
      {#each upcoming.slice(0, 3) as row (row.event.id)}
        <button class="np-show" onclick={() => openShow(row)} title={row.event.url ? 'Open tickets' : 'No ticket link'}>
          <span class="np-show-date">{showDate(row.event.date)}</span>
          <span class="np-show-venue">{row.venue.name}</span>
          {#if supportLine(row)}
            <span class="np-show-sub">{supportLine(row)}</span>
          {/if}
        </button>
      {/each}
    </div>
    {#if upcoming.length > 3}
      <button class="np-shows-more" onclick={openShowsScreen}>
        +{upcoming.length - 3} more in Shows
      </button>
    {/if}
  </section>
{/if}

<style>
  .np-shows {
    margin: 0.55rem 0 0.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .np-shows-head {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--brick);
    font-size: 0.66rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }
  .np-shows-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }
  .np-show {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.4rem 0.7rem;
    background: color-mix(in srgb, var(--brick) 9%, transparent);
    border: 1px solid color-mix(in srgb, var(--brick) 28%, transparent);
    border-radius: var(--radius-lg);
    cursor: pointer;
    text-align: left;
    color: var(--espresso);
    transition: background 130ms ease, border-color 130ms ease, transform 80ms ease;
  }
  .np-show:hover {
    background: color-mix(in srgb, var(--brick) 15%, transparent);
    border-color: color-mix(in srgb, var(--brick) 45%, transparent);
  }
  .np-show:active {
    transform: translateY(1px);
  }
  .np-show:focus-visible {
    outline: 2px solid var(--brick);
    outline-offset: 2px;
  }
  .np-show-date {
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--brick);
    white-space: nowrap;
  }
  .np-show-venue {
    font-size: 0.82rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .np-show-sub {
    font-size: 0.74rem;
    color: var(--faded);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 18ch;
  }
  .np-shows-more {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: 0.74rem;
    color: var(--faded);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .np-shows-more:hover {
    color: var(--brick);
  }
</style>
