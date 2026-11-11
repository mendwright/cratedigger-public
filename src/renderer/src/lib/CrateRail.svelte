<script lang="ts">
  import { tick } from 'svelte'
  import { plexState } from './plex-state.svelte'
  import type { PlexCollection } from '../../../shared/plex'
  import { albumDragActive, readAlbumDrag, type AlbumDragPayload } from './album-drag'
  import { PUBLIC_BUILD } from '../../../shared/build-flags'
  import {
    PICKS_SHELVES,
    picksOnShelf,
    picksShelfName,
    type PicksShelf
  } from '../../../shared/accolades'

  // The crate rail: a narrow column down the left of the Library. Two
  // sections, one selection between them, filtering the grid in place:
  //   crates — the user's own hand-picked shelves (Plex collections),
  //            pinned on top, with "+ new crate" to start an empty one.
  //   critics' picks — automatic shelves filled from the accolade index
  //            (shared/accolades.ts); only in Cratedigger, never Plex.
  //   studio — engineers/producers from Settings, via the cached MB credits.
  //   labels — record labels with two or more albums, biggest first.
  // A genre list used to sit here; dropped 2026-11-05 as noise. Genres are
  // still filterable from the FocusBar's "+ genre" panel.
  //
  // Not a theme. Warehouse's mockup put a rail like this on the left, which is
  // why that theme got cut from the first five — a theme isn't allowed to add
  // navigation. So it's an ordinary Library feature every theme gets, styled
  // through the same [data-theme] blocks as everything else.
  //
  // Selection goes through plexState.pickRailCrate / setGenreCrate, which
  // replace the whole rail selection rather than adding to it. That means the
  // rail and the FocusBar chips are the same filters seen two ways: pick here
  // and the chip shows up in the FocusBar, clear it there and the rail
  // deselects. If the chip panel is used to stack filters (two genres, or a
  // crate plus a genre), the rail draws nothing as selected rather than lying
  // about which crate you're in.

  // Counts come off the full-library cache, the same source the "+ genre"
  // panel uses. Library's editorial rails already trigger this load on mount,
  // so the rail is not what pays for it — but ask anyway, in case the rail
  // ever renders somewhere they don't.
  $effect(() => {
    if (plexState.allAlbums === null) void plexState.ensureAllAlbumsLoaded()
  })

  // The personal-crate list lives on the server; (re)fetch when the rail is
  // up and the active section is known.
  $effect(() => {
    if (plexState.activeSectionKey) void plexState.cratesCtl.refresh()
  })

  const selected = $derived(plexState.crateGenre)
  const fs = $derived(plexState.filterState)
  // A personal crate draws as selected only when it's the sole rail-shaped
  // filter — same honesty rule as crateGenre.
  const noLabels = $derived(fs.labelInclude.size === 0 && fs.labelExclude.size === 0)
  const selectedCrateKey = $derived(
    fs.genreInclude.size === 0 &&
      fs.genreExclude.size === 0 &&
      noLabels &&
      plexState.activePicksShelf === null &&
      plexState.activeStudioShelf === null
      ? (fs.selectedCrate?.ratingKey ?? null)
      : null
  )
  // Critics' shelves: automatic crates filled from the accolade index. Same
  // honesty rule — drawn as selected only when nothing else is stacked.
  const selectedShelf = $derived(
    fs.genreInclude.size === 0 &&
      fs.genreExclude.size === 0 &&
      fs.selectedCrate === null &&
      noLabels &&
      plexState.activeStudioShelf === null
      ? plexState.activePicksShelf
      : null
  )
  // Studio shelves: one per configured engineer/producer with albums here.
  const selectedStudio = $derived(
    fs.genreInclude.size === 0 &&
      fs.genreExclude.size === 0 &&
      fs.selectedCrate === null &&
      noLabels &&
      plexState.activePicksShelf === null
      ? plexState.activeStudioShelf
      : null
  )
  const studioShelves = $derived(
    plexState.studio.people
      .map((p) => ({ name: p.name, count: Object.keys(p.albums).length }))
      .filter((p) => p.count > 0)
  )
  const shelves = $derived.by((): { shelf: PicksShelf; count: number }[] => {
    if (PUBLIC_BUILD || plexState.accolades.entries.length === 0) return []
    const enabled = plexState.settings.accoladeSources
    const visible = PICKS_SHELVES.filter((s) => s === 'all' || enabled.includes(s))
    const counts = new Map<PicksShelf, number>(visible.map((s) => [s, 0]))
    for (const a of plexState.allAlbums ?? plexState.albums) {
      const picks = plexState.accolades.lookup(a.artist, a.title)
      if (picks.length === 0) continue
      for (const s of visible) {
        if (picksOnShelf(picks, s).length > 0) counts.set(s, (counts.get(s) ?? 0) + 1)
      }
    }
    return visible.map((shelf) => ({ shelf, count: counts.get(shelf) ?? 0 }))
  })
  const nothingPicked = $derived(
    selected === null &&
      selectedCrateKey === null &&
      selectedShelf === null &&
      selectedStudio === null &&
      noLabels
  )

  // Labels: every record label with at least two albums here, biggest first,
  // folded through the label aliases. Long tails collapse behind "show all".
  const selectedLabel = $derived(fs.crateLabel())
  const LABELS_SHOWN = 40
  let showAllLabels = $state(false)
  const labelRows = $derived.by(() => {
    const counts = new Map<string, number>()
    for (const a of plexState.allAlbums ?? plexState.albums) {
      for (const c of plexState.labelsFor(a)) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    return [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  })
  const visibleLabels = $derived.by(() => {
    const top = showAllLabels ? labelRows : labelRows.slice(0, LABELS_SHOWN)
    // Keep the open label visible even when it's in the collapsed tail.
    if (selectedLabel && !top.some(([n]) => n === selectedLabel)) {
      const hit = labelRows.find(([n]) => n === selectedLabel)
      return [...top, hit ?? ([selectedLabel, 0] as [string, number])]
    }
    return top
  })
  const myCrates = $derived(plexState.cratesCtl.crates)

  // "+ new crate" flips into an inline name input. When a record was dropped
  // on it, `pendingDrop` holds the album and the new crate starts with it.
  let naming = $state(false)
  let newName = $state('')
  let nameInput = $state<HTMLInputElement | null>(null)
  let pendingDrop = $state<AlbumDragPayload | null>(null)

  async function startNaming(drop: AlbumDragPayload | null = null): Promise<void> {
    pendingDrop = drop
    naming = true
    await tick()
    nameInput?.focus()
  }

  function cancelNaming(): void {
    naming = false
    newName = ''
    pendingDrop = null
  }

  async function submitName(e: Event): Promise<void> {
    e.preventDefault()
    const name = newName.trim()
    const drop = pendingDrop
    if (!name) return cancelNaming()
    cancelNaming()
    if (drop) {
      await plexState.cratesCtl.create(name, {
        ratingKey: drop.ratingKey,
        label: `${drop.artist} — ${drop.title}`
      })
    } else {
      await plexState.cratesCtl.createEmpty(name)
    }
  }

  // Drag a record from the grid onto a crate row to file it. `dropKey`
  // tracks which row is under the drag for the highlight — a crate's
  // ratingKey, or 'new' for the "+ new crate" row.
  let dropKey = $state<string | null>(null)

  function onRowDragOver(e: DragEvent, key: string): void {
    if (!albumDragActive(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    dropKey = key
  }

  function onRowDragLeave(e: DragEvent): void {
    // dragleave also fires when the pointer crosses into a child span —
    // only clear when it actually left the row.
    const row = e.currentTarget as HTMLElement
    if (!(e.relatedTarget instanceof Node) || !row.contains(e.relatedTarget)) dropKey = null
  }

  function onCrateDrop(e: DragEvent, c: PlexCollection): void {
    dropKey = null
    const album = readAlbumDrag(e)
    if (!album) return
    e.preventDefault()
    void plexState.cratesCtl.add(c, {
      ratingKey: album.ratingKey,
      label: `${album.artist} — ${album.title}`
    })
  }

  function onNewCrateDrop(e: DragEvent): void {
    dropKey = null
    const album = readAlbumDrag(e)
    if (!album) return
    e.preventDefault()
    void startNaming(album)
  }

  function pickCrate(c: PlexCollection): void {
    plexState.pickRailCrate(
      selectedCrateKey === c.ratingKey ? null : { ratingKey: c.ratingKey, title: c.title }
    )
  }

  const totalCount = $derived((plexState.allAlbums ?? plexState.albums).length)

</script>

<aside class="crates" data-rail="crates" aria-label="Crates">
  <div class="crate-label">crates</div>
  <ul class="crate-list">
    <li>
      <button
        class="crate"
        class:crate-open={nothingPicked}
        data-crate
        aria-current={nothingPicked ? 'true' : undefined}
        onclick={() => plexState.setGenreCrate(null)}
      >
        <span class="crate-name">everything</span>
        {#if totalCount > 0}<span class="crate-count">{totalCount.toLocaleString()}</span>{/if}
      </button>
    </li>
    {#each myCrates as c (c.ratingKey)}
      <li>
        <button
          class="crate"
          class:crate-open={selectedCrateKey === c.ratingKey}
          class:drop-target={dropKey === c.ratingKey}
          data-crate
          aria-current={selectedCrateKey === c.ratingKey ? 'true' : undefined}
          title={`${c.title} — ${c.childCount.toLocaleString()} album${c.childCount === 1 ? '' : 's'}`}
          onclick={() => pickCrate(c)}
          ondragover={(e) => onRowDragOver(e, c.ratingKey)}
          ondragleave={onRowDragLeave}
          ondrop={(e) => onCrateDrop(e, c)}
        >
          <span class="crate-name">{c.title}</span>
          {#if c.childCount > 0}<span class="crate-count">{c.childCount.toLocaleString()}</span>{/if}
        </button>
      </li>
    {/each}
    <li>
      {#if naming}
        <form class="new-crate-form" onsubmit={submitName}>
          <input
            bind:this={nameInput}
            bind:value={newName}
            type="text"
            placeholder={pendingDrop ? `crate for ${pendingDrop.title}…` : 'crate name…'}
            onblur={cancelNaming}
            onkeydown={(e) => e.key === 'Escape' && cancelNaming()}
          />
        </form>
      {:else}
        <button
          class="new-crate"
          class:drop-target={dropKey === 'new'}
          onclick={() => void startNaming()}
          ondragover={(e) => onRowDragOver(e, 'new')}
          ondragleave={onRowDragLeave}
          ondrop={onNewCrateDrop}
          title="Start a new crate — click, or drop a record here"
        >
          + new crate
        </button>
      {/if}
    </li>
  </ul>
  {#if shelves.length > 0}
    <div class="crate-label genre-label" title="Filled automatically from the critics' picks — only in Cratedigger, not Plex">
      critics' picks
    </div>
    <ul class="crate-list">
      {#each shelves as { shelf, count } (shelf)}
        <li>
          <button
            class="crate"
            class:crate-open={selectedShelf === shelf}
            data-crate
            aria-current={selectedShelf === shelf ? 'true' : undefined}
            title={`${picksShelfName(shelf)} — ${count.toLocaleString()} of your albums, newest pick first`}
            onclick={() => plexState.pickRailPicks(selectedShelf === shelf ? null : shelf)}
          >
            <span class="crate-name">{picksShelfName(shelf)}</span>
            {#if count > 0}<span class="crate-count">{count.toLocaleString()}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if studioShelves.length > 0}
    <div class="crate-label genre-label" title="From the MusicBrainz credits — who recorded, produced or mixed it. Edit the names in Settings.">
      studio
    </div>
    <ul class="crate-list">
      {#each studioShelves as { name, count } (name)}
        <li>
          <button
            class="crate"
            class:crate-open={selectedStudio === name}
            data-crate
            aria-current={selectedStudio === name ? 'true' : undefined}
            title={`Recorded, produced or mixed by ${name} — ${count.toLocaleString()} of your albums`}
            onclick={() => plexState.pickRailStudio(selectedStudio === name ? null : name)}
          >
            <span class="crate-name">{name}</span>
            <span class="crate-count">{count.toLocaleString()}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if labelRows.length > 0}
    <div class="crate-label genre-label">labels</div>
    <ul class="crate-list">
      {#each visibleLabels as [name, count] (name)}
        <li>
          <button
            class="crate"
            class:crate-open={selectedLabel === name}
            data-crate
            aria-current={selectedLabel === name ? 'true' : undefined}
            title={`${name} — ${count.toLocaleString()} album${count === 1 ? '' : 's'}`}
            onclick={() => plexState.pickRailLabel(selectedLabel === name ? null : name)}
          >
            <span class="crate-name">{name}</span>
            {#if count > 0}<span class="crate-count">{count.toLocaleString()}</span>{/if}
          </button>
        </li>
      {/each}
      {#if labelRows.length > LABELS_SHOWN}
        <li>
          <button class="new-crate" onclick={() => (showAllLabels = !showAllLabels)}>
            {showAllLabels ? 'show fewer' : `show all ${labelRows.length.toLocaleString()} labels`}
          </button>
        </li>
      {/if}
    </ul>
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
  .genre-label {
    margin-top: 0.5rem;
    padding-top: 0.55rem;
    border-top: 1px solid var(--hairline);
  }
  .new-crate {
    width: 100%;
    background: transparent;
    border: 1px dashed var(--hairline-strong);
    border-radius: var(--radius-sm);
    color: var(--faded);
    font: inherit;
    font-size: 0.74rem;
    text-align: left;
    padding: 0.28rem 0.5rem;
    cursor: pointer;
    margin-top: 2px;
    transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
  }
  .new-crate:hover {
    color: var(--brick);
    border-color: var(--brick);
    background: var(--brick-wash);
  }
  /* Row under a dragged record — the crate opening up to take it. */
  .crate.drop-target,
  .crate.drop-target:hover {
    background: var(--brick-wash);
    color: var(--brick-ink);
    box-shadow: inset 0 0 0 1px var(--brick);
  }
  .new-crate.drop-target {
    color: var(--brick);
    border-color: var(--brick);
    border-style: solid;
    background: var(--brick-wash);
  }
  .new-crate-form input {
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--brick);
    border-radius: var(--radius-sm);
    color: inherit;
    font: inherit;
    font-size: 0.78rem;
    padding: 0.26rem 0.5rem;
    margin-top: 2px;
    box-sizing: border-box;
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
    color: var(--on-brick);
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
    color: var(--on-brick);
    opacity: 0.75;
  }
</style>
