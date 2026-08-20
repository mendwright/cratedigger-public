<script lang="ts">
  import { plexState } from './plex-state.svelte'

  const fs = $derived(plexState.filterState)
  const genreInclude = $derived(fs.genreInclude)
  const genreExclude = $derived(fs.genreExclude)
  const labelInclude = $derived(fs.labelInclude)
  const labelExclude = $derived(fs.labelExclude)
  const selectedDecade = $derived(fs.selectedDecade)
  const selectedYear = $derived(fs.selectedYear)
  const selectedMood = $derived(fs.selectedMood)
  const selectedPlaystate = $derived(fs.selectedPlaystate)

  const playstateFilterActive = $derived(selectedPlaystate !== 'all')
  const yearFilterActive = $derived(selectedDecade != null || selectedYear != null)
  const moodFilterActive = $derived(selectedMood !== null)
  const totalChipCount = $derived(
    genreInclude.size +
      genreExclude.size +
      labelInclude.size +
      labelExclude.size +
      (yearFilterActive ? 1 : 0) +
      (moodFilterActive ? 1 : 0) +
      (playstateFilterActive ? 1 : 0)
  )
  const anyActive = $derived(totalChipCount > 0)

  function playstateLabel(state: typeof selectedPlaystate): string {
    if (state === 'unplayed') return 'unplayed'
    if (state === 'stale-6m') return 'stale 6mo+'
    if (state === 'stale-1y') return 'stale 1yr+'
    if (state === 'stale-2y') return 'stale 2yr+'
    return ''
  }
</script>

<div class="focus-bar" role="region" aria-label="Focus filters">
  <div class="add-row">
    <button
      class="add"
      class:active={genreInclude.size + genreExclude.size > 0}
      onclick={() => plexState.openGenreFilter()}
      title="Add a genre filter"
    >+ genre</button>
    <button
      class="add"
      class:active={yearFilterActive}
      onclick={() => plexState.openDecadeFilter()}
      title="Add a year or decade filter"
    >+ year</button>
    <button
      class="add"
      class:active={labelInclude.size + labelExclude.size > 0}
      onclick={() => plexState.openLabelFilter()}
      title="Add a label filter"
    >+ label</button>
    <div class="playstate-wrap">
      <button
        class="add"
        class:active={playstateFilterActive}
        onclick={() => (plexState.playstateFilterOpen = !plexState.playstateFilterOpen)}
        title="Add a play-state filter"
      >+ play state</button>
      {#if plexState.playstateFilterOpen}
        <ul class="playstate-menu" role="menu">
          {#each [
            { v: 'all', label: 'Any', hint: 'no filter' },
            { v: 'unplayed', label: 'Unplayed', hint: 'never played' },
            { v: 'stale-6m', label: 'Stale 6mo+', hint: 'last played > 6 months ago' },
            { v: 'stale-1y', label: 'Stale 1yr+', hint: 'last played > 1 year ago' },
            { v: 'stale-2y', label: 'Stale 2yr+', hint: 'last played > 2 years ago' }
          ] as opt (opt.v)}
            <li>
              <button
                class="playstate-opt"
                class:active={selectedPlaystate === opt.v}
                onclick={() => {
                  plexState.setPlaystate(opt.v as typeof selectedPlaystate)
                  plexState.playstateFilterOpen = false
                }}
              >
                <span class="playstate-label">{opt.label}</span>
                <span class="playstate-hint">{opt.hint}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if anyActive}
      <span class="sep" aria-hidden="true">·</span>

      {#each [...genreInclude] as g (`gi-${g}`)}
        <span class="chip include" title="Including {g} — click to exclude">
          <button class="chip-body" onclick={() => plexState.flipGenre(g)}>
            <span class="chip-glyph">+</span>{g}
          </button>
          <button class="chip-x" onclick={() => plexState.removeGenre(g)} aria-label="Remove" title="Remove">×</button>
        </span>
      {/each}
      {#each [...genreExclude] as g (`ge-${g}`)}
        <span class="chip exclude" title="Excluding {g} — click to include">
          <button class="chip-body" onclick={() => plexState.flipGenre(g)}>
            <span class="chip-glyph">−</span>{g}
          </button>
          <button class="chip-x" onclick={() => plexState.removeGenre(g)} aria-label="Remove" title="Remove">×</button>
        </span>
      {/each}

      {#if selectedYear != null}
        <span class="chip neutral" title="Year">
          <span class="chip-body static">{selectedYear}</span>
          <button class="chip-x" onclick={() => plexState.setYear(null)} aria-label="Remove" title="Remove">×</button>
        </span>
      {:else if selectedDecade != null}
        <span class="chip neutral" title="Decade">
          <span class="chip-body static">{selectedDecade}s</span>
          <button class="chip-x" onclick={() => plexState.setDecade(null)} aria-label="Remove" title="Remove">×</button>
        </span>
      {/if}

      {#each [...labelInclude] as name (`li-${name}`)}
        <span class="chip include" title="Including label {name} — click to exclude">
          <button class="chip-body" onclick={() => plexState.flipLabel(name)}>
            <span class="chip-glyph">+</span>{name}
          </button>
          <button class="chip-x" onclick={() => plexState.removeLabel(name)} aria-label="Remove" title="Remove">×</button>
        </span>
      {/each}
      {#each [...labelExclude] as name (`le-${name}`)}
        <span class="chip exclude" title="Excluding label {name} — click to include">
          <button class="chip-body" onclick={() => plexState.flipLabel(name)}>
            <span class="chip-glyph">−</span>{name}
          </button>
          <button class="chip-x" onclick={() => plexState.removeLabel(name)} aria-label="Remove" title="Remove">×</button>
        </span>
      {/each}

      {#if moodFilterActive && selectedMood}
        <span class="chip neutral" title="Mood — albums tagged {selectedMood.title}">
          <span class="chip-body static">{selectedMood.title.toLowerCase()}</span>
          <button class="chip-x" onclick={() => plexState.clearMood()} aria-label="Remove" title="Remove">×</button>
        </span>
      {/if}

      {#if playstateFilterActive}
        <span class="chip neutral" title="Play state">
          <span class="chip-body static">{playstateLabel(selectedPlaystate)}</span>
          <button class="chip-x" onclick={() => plexState.setPlaystate('all')} aria-label="Remove" title="Remove">×</button>
        </span>
      {/if}

      {#if totalChipCount > 1}
        <button class="clear-all" onclick={() => plexState.clearAllFilters()}>clear all</button>
      {/if}
    {/if}
  </div>
</div>

<style>
  .focus-bar {
    margin: 0 0 0.4rem;
    padding: 0.45rem 0;
    border-bottom: 1px solid var(--hairline);
  }
  .add-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.5rem;
  }
  .add {
    background: transparent;
    color: var(--walnut);
    border: 1px dashed var(--hairline-strong);
    padding: 0.3rem 0.7rem;
    border-radius: var(--radius-pill);
    font-size: 0.74rem;
    cursor: pointer;
    transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
  }
  .add:hover {
    color: var(--brick);
    border-color: var(--brick);
    background: var(--brick-wash);
  }
  .add.active {
    color: var(--brick);
    border-color: var(--brick);
    border-style: solid;
    background: var(--brick-wash);
  }

  .sep { color: var(--hairline); padding: 0 0.15rem; }

  .chip {
    display: inline-flex;
    align-items: stretch;
    border-radius: var(--radius-pill);
    overflow: hidden;
    border: 1px solid var(--hairline);
    background: var(--surface);
    font-size: 0.74rem;
  }
  .chip-body {
    background: transparent;
    border: 0;
    color: inherit;
    padding: 0.22rem 0.55rem 0.22rem 0.65rem;
    cursor: pointer;
    font: inherit;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .chip-body.static { cursor: default; }
  .chip-x {
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    padding: 0 0.45rem;
    font-size: 0.95rem;
    line-height: 1;
    opacity: 0.65;
  }
  .chip-x:hover { opacity: 1; background: var(--ink-tint-08); }
  .chip-glyph {
    font-weight: 700;
    font-size: 0.85rem;
    line-height: 1;
  }

  .chip.include {
    border-color: var(--ok-border);
    background: var(--ok-bg);
    color: var(--ok-fg);
  }
  .chip.exclude {
    border-color: var(--warn-border);
    background: var(--warn-bg);
    color: var(--warn-fg);
  }
  .chip.neutral {
    border-color: var(--brick);
    background: var(--brick-wash);
    color: var(--brick-deep);
  }

  .clear-all {
    background: transparent;
    color: var(--faded);
    border: 0;
    font-size: 0.72rem;
    cursor: pointer;
    padding: 0.2rem 0.4rem;
    border-radius: var(--radius-sm);
  }
  .clear-all:hover { color: var(--espresso); }

  .playstate-wrap {
    position: relative;
    display: inline-flex;
  }
  .playstate-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    list-style: none;
    margin: 0;
    padding: 0.3rem;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    min-width: 220px;
    box-shadow: var(--shadow-lg);
    z-index: 50;
  }
  .playstate-menu li { list-style: none; }
  .playstate-opt {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    padding: 0.5rem 0.65rem;
    border-radius: var(--radius-md);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    color: var(--walnut);
  }
  .playstate-opt:hover { background: var(--ink-tint-04); }
  .playstate-opt.active { background: var(--brick-wash); color: var(--brick-deep); }
  .playstate-label { font-size: 0.85rem; font-weight: 500; }
  .playstate-hint { font-size: 0.7rem; color: var(--faded); }
</style>
