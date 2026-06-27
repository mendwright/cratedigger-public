<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { AlbumDetail } from '../../../../shared/plex'
  import { plexState } from '../plex-state.svelte'

  // The chrome shared by the album-detail and now-playing screens: the
  // scrolling section, the blurred cover backdrop, the sticky cover + body
  // grid, and the load/empty/error states. Each screen supplies its own
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
    footer
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
    {#if src}
      <div class="art-bg" style="background-image: url('{src}')" aria-hidden="true"></div>
      <div class="art-bg-fade" aria-hidden="true"></div>
    {/if}
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
  .art-bg {
    position: fixed;
    inset: -80px;
    background-size: cover;
    background-position: center;
    filter: blur(80px) saturate(1.4);
    opacity: 0.22;
    z-index: -2;
    transform: scale(1.1);
    pointer-events: none;
  }
  .art-bg-fade {
    /* Theme-aware scrim — color-mix with --paper so the fade lands on the
       page background regardless of light/dark theme. The ramp goes near-
       opaque early so dark album art doesn't muddy the description text. */
    position: fixed;
    inset: 0;
    background:
      linear-gradient(180deg,
        color-mix(in srgb, var(--paper) 78%, transparent) 0%,
        color-mix(in srgb, var(--paper) 95%, transparent) 40%,
        var(--paper) 100%),
      radial-gradient(ellipse at top, transparent, color-mix(in srgb, var(--paper) 60%, transparent) 80%);
    z-index: -1;
    pointer-events: none;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    -webkit-app-region: drag;
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
    max-width: 720px;
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
