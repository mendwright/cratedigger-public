<script lang="ts">
  import { plexState } from './plex-state.svelte'

  // The crate rail: a narrow column down the left of the Library listing every
  // genre with a count, one selected at a time, filtering the grid in place.
  //
  // Not a theme. Warehouse's mockup put a rail like this on the left, which is
  // why that theme got cut from the first five — a theme isn't allowed to add
  // navigation. So it's an ordinary Library feature every theme gets, styled
  // through the same [data-theme] blocks as everything else.
  //
  // Selection goes through filterState.setGenreCrate, which replaces the genre
  // selection rather than adding to it. That means the rail and the "+ genre"
  // chip panel are the same filter seen two ways: pick a crate here and the
  // chip shows up in the FocusBar, clear it there and the rail deselects. If
  // the panel is used to include two genres at once, the rail draws nothing as
  // selected rather than lying about which crate you're in.

  // Counts come off the full-library cache, the same source the "+ genre"
  // panel uses. Library's editorial rails already trigger this load on mount,
  // so the rail is not what pays for it — but ask anyway, in case the rail
  // ever renders somewhere they don't.
  $effect(() => {
    if (plexState.allAlbums === null) void plexState.ensureAllAlbumsLoaded()
  })

  const selected = $derived(plexState.crateGenre)
  const loading = $derived(plexState.allAlbumsLoading && plexState.allAlbums === null)

  const crates = $derived.by(() => {
    const source = plexState.allAlbums ?? plexState.albums
    const counts = new Map<string, number>()
    for (const a of source) {
      for (const g of a.genres) {
        if (!g) continue
        counts.set(g, (counts.get(g) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1]
      return a[0].localeCompare(b[0])
    })
  })

  // The selected crate can be a genre that isn't in `crates` — the grid is
  // filtered to it, so `allAlbums` is the only place it still shows up, and
  // that cache can be a page behind. Pin it in so the rail never draws an
  // empty selection.
  const rows = $derived.by(() => {
    if (selected === null || crates.some(([name]) => name === selected)) return crates
    return [[selected, 0] as [string, number], ...crates]
  })

  const totalCount = $derived((plexState.allAlbums ?? plexState.albums).length)

  function pick(genre: string): void {
    plexState.setGenreCrate(selected === genre ? null : genre)
  }
</script>

<aside class="crates" data-rail="crates" aria-label="Crates">
  <div class="crate-label">crates</div>
  <ul class="crate-list">
    <li>
      <button
        class="crate"
        class:crate-open={selected === null}
        data-crate
        aria-current={selected === null ? 'true' : undefined}
        onclick={() => plexState.setGenreCrate(null)}
      >
        <span class="crate-name">everything</span>
        {#if totalCount > 0}<span class="crate-count">{totalCount.toLocaleString()}</span>{/if}
      </button>
    </li>
    {#each rows as [name, count] (name)}
      <li>
        <button
          class="crate"
          class:crate-open={selected === name}
          data-crate
          aria-current={selected === name ? 'true' : undefined}
          title={`${name} — ${count.toLocaleString()} album${count === 1 ? '' : 's'}`}
          onclick={() => pick(name)}
        >
          <span class="crate-name">{name}</span>
          {#if count > 0}<span class="crate-count">{count.toLocaleString()}</span>{/if}
        </button>
      </li>
    {/each}
  </ul>
  {#if loading}
    <p class="crate-hint">counting…</p>
  {:else if crates.length === 0}
    <p class="crate-hint">no genres tagged</p>
  {/if}
</aside>

<style>
  /* Sticky inside Library's own scroller, under the sticky ScreenHeader. The
     rail scrolls on its own once the genre list outruns the viewport, so a
     library with two hundred genres doesn't stretch the page. */
  .crates {
    position: sticky;
    /* Directly under the sticky ScreenHeader, whose height Library measures
       and hands down as --rail-top. Sticking at 0 would slide the rail behind
       the bar's blur. */
    top: var(--rail-top, 4.5rem);
    align-self: start;
    width: 168px;
    max-height: calc(100vh - var(--rail-top, 4.5rem) - 7rem);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding-right: 0.75rem;
    border-right: 1px solid var(--hairline);
  }
  .crate-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--faded);
    font-weight: 700;
    padding: 0.15rem 0.5rem;
  }
  .crate-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .crate {
    width: 100%;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--walnut);
    font: inherit;
    font-size: 0.78rem;
    text-align: left;
    padding: 0.3rem 0.5rem;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }
  .crate:hover {
    background: var(--ink-tint-06);
    color: var(--espresso);
  }
  /* The open crate is a fill, so its text takes --paper — the same rule every
     other filled control follows, and the one that keeps Warehouse's hi-vis
     accent readable. */
  .crate-open,
  .crate-open:hover {
    background: var(--brick);
    color: var(--paper);
  }
  .crate-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .crate-count {
    font-size: 0.68rem;
    color: var(--faded);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .crate-open .crate-count {
    color: var(--paper);
    opacity: 0.75;
  }
  .crate-hint {
    font-size: 0.72rem;
    color: var(--faded);
    margin: 0;
    padding: 0.3rem 0.5rem;
  }
</style>
