<script lang="ts">
  /**
   * The one screen header. Every top-level screen wears this so they read as
   * the same app: a kicker naming the place, a display-face title naming the
   * specific thing, and a quiet sub line for counts and current sort.
   *
   * Extracted from Library's header rather than invented — that one was
   * already the right design, it was just the only screen that had it.
   *
   * The bar bleeds edge-to-edge past its screen's padding. Screens whose
   * padding isn't the usual 2rem set `--screen-header-bleed` to match, e.g.
   * `<ScreenHeader … --screen-header-bleed="1.5rem" />`.
   */
  import type { Snippet } from 'svelte'
  import BackButton from './BackButton.svelte'

  interface Props {
    /** Renders the shared BackButton ahead of the title when provided. */
    onback?: () => void
    /** The place — `library`, `playlists`, `artist`. Rendered uppercase. */
    kicker: string
    /** The specific thing — server name, playlist name, artist name. */
    title: string
    /** Counts, current sort, durations. e.g. `4,318 albums · sorted by date added`. */
    sub?: string
    /** Right-aligned, before `actions`. Typically a search field. */
    search?: Snippet
    /** Right-aligned controls — sort menus, size sliders, buttons. */
    actions?: Snippet
    /** Extra classes on the <header>, for per-screen stacking tweaks. */
    class?: string
  }

  let { onback, kicker, title, sub, search, actions, class: klass = '' }: Props = $props()
</script>

<header class="screen-header {klass}">
  <div class="inner">
    {#if onback}<BackButton onclick={onback} />{/if}
    <div class="ident">
      <div class="kicker">{kicker}</div>
      <div class="title">{title}</div>
      {#if sub}<div class="sub">{sub}</div>{/if}
    </div>
    {#if search}
      <div class="search-slot">{@render search()}</div>
    {/if}
    {#if actions}
      <div class="actions">{@render actions()}</div>
    {/if}
  </div>
</header>

<style>
  .screen-header {
    display: block;
    position: sticky;
    top: 0;
    z-index: 5;
    margin-inline: calc(-1 * var(--screen-header-bleed, 2rem));
    padding: 0.7rem var(--screen-header-bleed, 2rem);
    background: color-mix(in srgb, var(--paper) 88%, transparent);
    backdrop-filter: blur(20px) saturate(1.1);
    -webkit-backdrop-filter: blur(20px) saturate(1.1);
    border-bottom: 1px solid var(--hairline);
    /* Not a window-drag surface. This used to be `drag` on Library with each
       control punching a `no-drag` hole; macOS caches those hole rects and a
       sticky full-width header re-lays-out constantly, so once they went stale
       the controls in it stopped responding until a reload. Dragging lives on
       the toolbar's one fixed handle — see TopToolbar's .drag-fill. Don't make
       this draggable. */
    -webkit-app-region: no-drag;
  }
  /* The bar's background and hairline span the whole window, but its contents
     line up with the screen's own content column. Screens that centre their
     body in a fixed column pass `--screen-header-max` to match it — without
     that the title ends up pinned to the far left and the actions to the far
     right, floating either side of content that's centred a few hundred pixels
     inboard. Screens whose body is full-width leave it unset. */
  .inner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    max-width: var(--screen-header-max, none);
    margin-inline: auto;
  }
  .ident {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    flex-shrink: 0;
    min-width: 0;
  }
  .kicker {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--brick);
    font-weight: 700;
  }
  .title {
    font-family: var(--font-display);
    font-size: 1.3rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--espresso);
    max-width: 46ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 0.78rem;
    color: var(--faded);
  }
  .search-slot {
    flex: 1 1 auto;
    display: flex;
    justify-content: center;
    min-width: 0;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
    margin-left: auto;
  }
</style>
