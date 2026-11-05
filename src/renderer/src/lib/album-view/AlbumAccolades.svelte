<script lang="ts">
  import { plexState } from '../plex-state.svelte'
  import { safeExternalHref } from '../../../../shared/urls'
  import {
    ACCOLADE_SOURCE_NAMES,
    stickerText,
    type Accolade
  } from '../../../../shared/accolades'

  // Critics' picks for the open album, listed under the cover. The detail
  // page keeps its art clean — no sticker on it — and spells out every pick
  // here instead (the cover cards only have room for the top one + "+N").
  // Each row links to the review when the source gave us one.
  let { artist, title, ratingKey }: { artist: string; title: string; ratingKey: string } = $props()

  const picks = $derived(plexState.accolades.lookup(artist, title))
  // Studio badges: who recorded / produced / mixed it (shared/studio.ts).
  // Clicking one opens that person's credits page.
  const studio = $derived(plexState.studio.forAlbum(ratingKey))

  function what(a: Accolade): string {
    switch (a.kind) {
      case 'great':
        return 'new album he thinks is great'
      case 'year-end':
        return `Sacher era BV best of ${a.date.slice(0, 4)}${a.rank != null ? ` · #${a.rank}` : ''}`
      case 'aotw':
        return 'Album of the Week'
      case 'best-new':
        return 'Best New Music'
      case 'best-new-reissue':
        return 'Best New Reissue'
    }
  }

  function when(a: Accolade): string {
    if (!a.date || a.kind === 'year-end') return ''
    const d = new Date(`${a.date}T12:00:00`)
    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  }
</script>

{#if studio.length > 0}
  <section class="accolades" data-album-studio aria-label="Behind the board">
    <div class="head">behind the board</div>
    <ul>
      {#each studio as b (b.name)}
        <li>
          <button
            type="button"
            class="pick studio-pick"
            disabled={!b.mbid}
            title={b.mbid ? `See everything ${b.name} is credited on` : undefined}
            onclick={() => b.mbid && plexState.openEntity(b.mbid, b.name)}
          >
            <span class="seal studio-seal" aria-hidden="true">{b.how === 'recorded' ? 'REC' : b.how === 'produced' ? 'PROD' : 'MIX'}</span>
            <span class="text">
              <span class="who">{b.name}</span>
              <span class="what">{b.how} this record{#if b.mbid}<span class="arrow">{' →'}</span>{/if}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if picks.length > 0}
  <section class="accolades" data-album-accolades aria-label="Critics' picks">
    <div class="head">critics' picks</div>
    <ul>
      {#each picks as a (a.source + a.kind)}
        {@const href = safeExternalHref(a.url)}
        <li>
          <svelte:element
            this={href ? 'a' : 'div'}
            class="pick"
            {href}
            target={href ? '_blank' : undefined}
            rel={href ? 'noreferrer' : undefined}
            title={href ? 'Read the review' : undefined}
          >
            <span class="seal" data-source={a.source} aria-hidden="true">{stickerText(a)}</span>
            <span class="text">
              <span class="who">{ACCOLADE_SOURCE_NAMES[a.source]}{#if a.score != null}<span class="score">{a.score.toFixed(1)}</span>{/if}</span>
              <span class="what">{what(a)}{#if when(a)}{` · ${when(a)}`}{/if}{#if href}<span class="arrow">{' ↗'}</span>{/if}</span>
            </span>
          </svelte:element>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .accolades {
    margin: 1rem 0 0;
    padding-top: 1rem;
    border-top: 1px solid var(--hairline);
  }
  .head {
    font-size: 0.78rem;
    text-transform: lowercase;
    letter-spacing: 0.04em;
    color: var(--faded);
    margin-bottom: 0.55rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: inherit;
    text-decoration: none;
    border-radius: var(--radius-sm);
    padding: 0.2rem 0.25rem 0.2rem 0;
  }
  a.pick:hover .who,
  button.pick:not(:disabled):hover .who {
    color: var(--brick);
  }
  button.pick {
    width: 100%;
    background: transparent;
    border: 0;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button.pick:disabled {
    cursor: default;
  }
  /* Studio tokens: plain kraft-paper label, so they read as credits rather
     than critics' stickers. */
  .seal.studio-seal {
    --paper: #d9c7a3;
    --ink: #3a2c17;
  }
  /* Same printed inks as the cover sticker (HypeSticker.svelte), shrunk to
     a token so the list reads as "these are the stickers". */
  .seal {
    --ink: #35270f;
    --paper: #f4cf59;
    flex: 0 0 auto;
    min-width: 2.6rem;
    padding: 0.22rem 0.4rem;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink);
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-align: center;
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ink) 22%, transparent);
  }
  .seal[data-source='stereogum'] {
    --paper: #83c9b7;
    --ink: #123e35;
  }
  .seal[data-source='pitchfork'] {
    --paper: #c94736;
    --ink: #fff2d7;
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 0.1rem;
  }
  .who {
    font-size: 0.8rem;
    color: var(--espresso);
    transition: color 140ms ease;
  }
  .score {
    margin-left: 0.4rem;
    font-weight: 700;
  }
  .what {
    font-size: 0.72rem;
    color: var(--faded);
  }
  .arrow {
    opacity: 0.7;
  }
</style>
