<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { AlbumDetail } from '../../../../shared/plex'
  import { plexState } from '../plex-state.svelte'

  // The chrome shared by the album-detail and now-playing screens: the
  // scrolling section, the sticky cover + body grid, and the load/empty/
  // error states. Each screen supplies its own
  // header (back vs. close), body content, and optional footer (up-next /
  // lightbox) via snippets, and computes its own `phase`.
  type Phase = 'empty' | 'loading' | 'error' | 'ready'

  let {
    detail,
    phase,
    error = null,
    emptyText = '',
    loadingText = 'loading album…',
    coverViewTransition = false,
    onArtContextMenu,
    header,
    body,
    footer,
    artBelow
  }: {
    detail: AlbumDetail | null
    phase: Phase
    error?: string | null
    emptyText?: string
    loadingText?: string
    // album-detail animates the cover via a view transition on open; now-
    // playing doesn't, so the transition name is opt-in.
    coverViewTransition?: boolean
    onArtContextMenu?: (e: MouseEvent) => void
    header: Snippet
    body: Snippet
    footer?: Snippet
    // Rendered inside the cover aside, under the art — the facts table on
    // album detail. Now-playing passes nothing and keeps a bare cover.
    artBelow?: Snippet
  } = $props()

  const src = $derived(
    detail ? plexState.thumbUrl(detail.album.thumb, 1200, detail.album.ratingKey) : null
  )
</script>

<section>
  <header>
    {@render header()}
  </header>

  {#if phase === 'empty'}
    <p class="hint centered">{emptyText}</p>
  {:else if phase === 'loading'}
    <p class="hint centered">{loadingText}</p>
  {:else if phase === 'error'}
    <p class="error">{error}</p>
  {:else if phase === 'ready' && detail}
    <div class="layout">
      <aside class="art" oncontextmenu={onArtContextMenu} role="presentation">
        {#if src}
          <img
            src={src}
            alt={detail.album.title}
            style={coverViewTransition ? 'view-transition-name: album-cover-active' : undefined}
          />
        {:else}
          <div
            class="cover-fallback"
            style={coverViewTransition ? 'view-transition-name: album-cover-active' : undefined}
          >{detail.album.title.slice(0, 1)}</div>
        {/if}
        {#if artBelow}{@render artBelow()}{/if}
      </aside>
      <div class="body">
        {@render body()}
      </div>
    </div>
  {/if}

  {#if footer}{@render footer()}{/if}
</section>

<style>
  section {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    background: var(--paper);
    position: relative;
    isolation: isolate;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    /* Not draggable. A full-width header with `no-drag` holes punched in it by
       its controls is the arrangement that keeps going stale on macOS — the
       holes expire, the strip acts as one drag region, and its controls stop
       responding. Dragging lives on TopToolbar's one fixed .drag-fill handle. */
    -webkit-app-region: no-drag;
    position: relative;
    z-index: 1;
    gap: 1rem;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(380px, 50%) 1fr;
    gap: 2.5rem;
    padding: 1rem 2rem 8rem;
  }
  .art {
    align-self: start;
    position: sticky;
    top: 1rem;
  }
  .art img,
  .cover-fallback {
    /* Sized so the cover AND the facts block under it fit without scrolling —
       the whole point of the aside is that it's the bit you can take in at a
       glance. The cover is square (aspect-ratio 1/1), so capping the *width*
       caps the height without distorting it; capping height directly would
       leave width at 100% and crop the art.

       The 25rem covers the toolbar, the screen header, the facts block and
       the transport bar. The floor keeps it sane on a short window. */
    max-width: clamp(240px, calc(100vh - 25rem), 720px);
  }
  .art img {
    width: 100%;
    aspect-ratio: 1/1;
    object-fit: cover;
    border-radius: var(--radius-xl);
    box-shadow:
      0 28px 70px rgba(43, 29, 18, 0.3),
      0 0 0 1px var(--ink-tint-04);
    display: block;
  }
  .cover-fallback {
    aspect-ratio: 1/1;
    background: var(--surface);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--whisper);
    font-size: 6rem;
    border-radius: var(--radius-xl);
  }
  .body {
    min-width: 0;
  }
  .hint {
    color: var(--faded);
    font-size: 0.85rem;
    margin: 0;
  }
  .hint.centered {
    padding: 4rem 2rem;
    text-align: center;
  }
  .error {
    color: var(--err-fg);
    padding: 2rem;
  }
  @media (max-width: 780px) {
    .layout {
      grid-template-columns: 1fr;
    }
    .art {
      position: static;
      max-width: 280px;
    }
  }
</style>
