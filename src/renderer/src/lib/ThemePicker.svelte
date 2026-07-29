<script lang="ts">
  import { plexState } from './plex-state.svelte'
  import { THEMES } from './themes'

  const selectedId = $derived(plexState.themeId)

  function close(): void {
    plexState.closeThemePicker()
  }

  function onBackdropKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
  }

  function pick(id: string): void {
    plexState.setTheme(id)
  }
</script>

{#if plexState.themePickerOpen}
  <div
    class="backdrop"
    role="button"
    tabindex="0"
    aria-label="Close theme picker"
    onclick={close}
    onkeydown={onBackdropKey}
  ></div>
  <aside class="panel" aria-label="Theme">
    <header>
      <div class="title-block">
        <h2>themes</h2>
        <p class="hint">click a swatch to apply — your choice persists between launches.</p>
      </div>
      <button class="x" onclick={close} aria-label="Close">✕</button>
    </header>

    <ul class="grid">
      {#each THEMES as t (t.id)}
        {@const isActive = selectedId === t.id}
        <li>
          <button
            class="theme-card"
            class:active={isActive}
            onclick={() => pick(t.id)}
            aria-pressed={isActive}
            title={t.mood}
            style="
              --p-paper: {t.tokens.paper};
              --p-surface: {t.tokens.surface};
              --p-espresso: {t.tokens.espresso};
              --p-walnut: {t.tokens.walnut};
              --p-brick: {t.tokens.brick};
              --p-hairline: {t.tokens.hairline};
              --p-font: {t.tokens['font-display']};
              --p-radius: {t.tokens['radius-md']};
            "
          >
            <div class="swatch-stack">
              <div class="page" style="background: var(--p-paper); border-color: var(--p-hairline);">
                <div class="specimen" style="color: var(--p-espresso);">Aa</div>
                <div class="page-card" style="background: var(--p-surface); border-color: var(--p-hairline);">
                  <div class="bar bar-title" style="background: var(--p-espresso);"></div>
                  <div class="bar bar-sub" style="background: var(--p-walnut);"></div>
                  <div class="bar bar-accent" style="background: var(--p-brick);"></div>
                </div>
                <div class="dots">
                  <span class="dot" style="background: var(--p-brick);"></span>
                  <span class="dot" style="background: var(--p-espresso);"></span>
                  <span class="dot" style="background: var(--p-walnut);"></span>
                </div>
              </div>
            </div>
            <div class="meta">
              <div class="name-row">
                <span class="name">{t.name}</span>
                <span class="scheme">{t.scheme}</span>
              </div>
              <div class="mood">{t.mood}</div>
            </div>
            {#if isActive}
              <span class="checkmark" aria-hidden="true">✓</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  </aside>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(43, 29, 18, 0.32);
    z-index: 65;
    border: 0;
    padding: 0;
  }
  .panel {
    position: fixed;
    top: 6vh;
    bottom: 6vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(92vw, 1100px);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-2xl);
    box-shadow: var(--shadow-lg);
    z-index: 70;
    color: var(--espresso);
    animation: pop 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @keyframes pop {
    from { transform: translate(-50%, 12px) scale(0.985); opacity: 0; }
    to { transform: translate(-50%, 0) scale(1); opacity: 1; }
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 1.1rem 1.4rem;
    border-bottom: 1px solid var(--hairline);
    gap: 1rem;
  }
  .title-block { display: flex; flex-direction: column; gap: 0.25rem; }
  h2 {
    font-family: var(--font-display);
    font-size: 1.4rem;
    font-weight: 600;
    margin: 0;
    color: var(--espresso);
  }
  .hint { margin: 0; font-size: 0.78rem; color: var(--faded); }
  .x {
    background: transparent;
    border: 0;
    color: var(--faded);
    font-size: 1.05rem;
    cursor: pointer;
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-md);
  }
  .x:hover { background: var(--ink-tint-08); color: var(--espresso); }

  .grid {
    list-style: none;
    margin: 0;
    padding: 1rem 1.4rem 1.4rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.9rem;
    overflow-y: auto;
  }
  .theme-card {
    position: relative;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.7rem;
    background: var(--inset);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-xl);
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: inherit;
    transition: transform 120ms ease, border-color 120ms ease, box-shadow 180ms ease;
  }
  .theme-card:hover {
    transform: translateY(-2px);
    border-color: var(--brick);
    box-shadow: var(--shadow-sm);
  }
  .theme-card.active {
    border-color: var(--brick);
    box-shadow: 0 0 0 2px var(--brick), var(--shadow-md);
  }

  .swatch-stack {
    /* Explicit width: as a flex item inside a <button>, this does not
       reliably stretch — Chrome lays button children out shrink-to-fit,
       which collapsed the preview to a postage stamp. */
    width: 100%;
    border-radius: var(--p-radius);
    overflow: hidden;
  }
  /* Type specimen in the theme's own display face — the fastest read on a
     theme's personality after its palette. */
  .specimen {
    position: absolute;
    top: 0.4rem;
    right: 0.6rem;
    font-family: var(--p-font);
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1;
    opacity: 0.85;
  }
  .page {
    position: relative;
    width: 100%;
    box-sizing: border-box;
    aspect-ratio: 16 / 9;
    border: 1px solid;
    border-radius: var(--p-radius);
    padding: 0.55rem;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 0.4rem;
  }
  .page-card {
    flex: 1;
    border: 1px solid;
    border-radius: var(--p-radius);
    padding: 0.35rem 0.45rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    justify-content: center;
  }
  .bar {
    height: 5px;
    border-radius: var(--radius-pill);
    width: 70%;
  }
  .bar-title { width: 80%; }
  .bar-sub { width: 55%; height: 4px; }
  .bar-accent { width: 35%; height: 8px; }
  .dots {
    display: flex;
    gap: 4px;
    justify-content: flex-start;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .name-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .name {
    font-family: var(--p-font);
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--espresso);
  }
  .scheme {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--faded);
  }
  .mood {
    font-size: 0.74rem;
    color: var(--walnut);
    line-height: 1.35;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .checkmark {
    position: absolute;
    top: 0.4rem;
    right: 0.5rem;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--brick);
    color: var(--inset);
    font-size: 0.78rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
