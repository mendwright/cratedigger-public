<script lang="ts">
  import { plexState } from './plex-state.svelte'

  const open = $derived(plexState.keyboardHelpOpen)

  function close(): void {
    plexState.keyboardHelpOpen = false
  }

  // On macOS show ⌘; on Linux/Windows show Ctrl. Detection is process-level
  // (Mac = Apple keyboard layout). Done once at render so the table stays
  // visually consistent in a single session.
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const mod = isMac ? '⌘' : 'Ctrl'

  type Row = { keys: string[]; label: string }
  type Group = { title: string; rows: Row[] }
  const groups: Group[] = [
    {
      title: 'Navigation',
      rows: [
        { keys: [mod, '1'], label: 'Library' },
        { keys: [mod, '2'], label: 'Inbox' },
        { keys: [mod, '3'], label: 'Triage' },
        { keys: [mod, '4'], label: 'Soulseek' },
        { keys: [mod, '5'], label: 'New & upcoming' },
        { keys: [mod, '6'], label: 'Shows' },
        { keys: [mod, '7'], label: 'Listen later' },
        { keys: [mod, '['], label: 'Back' },
        { keys: [mod, ']'], label: 'Forward' },
        { keys: ['Esc'], label: 'Close detail / clear search' }
      ]
    },
    {
      title: 'Search & browser',
      rows: [
        { keys: [mod, 'K'], label: 'Search library' },
        { keys: [mod, 'Shift', 'P'], label: 'Command palette' },
        { keys: [mod, 'B'], label: 'Toggle browser pane' }
      ]
    },
    {
      title: 'Now playing',
      rows: [
        { keys: [mod, 'T'], label: 'Theater mode' },
        { keys: [mod, 'Shift', 'M'], label: 'Mini player' },
        { keys: ['F7'], label: 'Previous (media key)' },
        { keys: ['F8'], label: 'Play / Pause (media key)' },
        { keys: ['F9'], label: 'Next (media key)' }
      ]
    },
    {
      title: 'Triage & inbox',
      rows: [
        { keys: ['J', 'K'], label: 'Move selection' },
        { keys: ['Enter'], label: 'Open selected' },
        { keys: ['A'], label: 'Approve flags (triage)' },
        { keys: ['D', 'D'], label: 'Delete selected (triage)' },
        { keys: ['1', '…', '9'], label: 'Pick MB candidate (inbox)' },
        { keys: [mod, 'Enter'], label: 'Apply match (inbox)' }
      ]
    },
    {
      title: 'Help',
      rows: [{ keys: ['?'], label: 'Show this overlay' }]
    }
  ]
</script>

{#if open}
  <div
    class="backdrop"
    onclick={close}
    role="presentation"
  >
    <div
      class="dialog"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kbd-help-title"
      tabindex="-1"
    >
      <div class="header">
        <h2 id="kbd-help-title">Keyboard shortcuts</h2>
        <button class="close" onclick={close} aria-label="Close">×</button>
      </div>
      <div class="groups">
        {#each groups as g (g.title)}
          <section class="group">
            <h3>{g.title}</h3>
            <ul>
              {#each g.rows as r (r.label)}
                <li>
                  <span class="combo">
                    {#each r.keys as k, i (i)}
                      {#if i > 0}<span class="plus">+</span>{/if}
                      <kbd>{k}</kbd>
                    {/each}
                  </span>
                  <span class="lbl">{r.label}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(43, 29, 18, 0.45);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1200;
    animation: fade-in var(--dur-base) var(--ease-out);
  }
  .dialog {
    background: var(--paper);
    color: var(--espresso);
    border: 1px solid var(--hairline-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    max-width: 640px;
    width: 92%;
    max-height: 84vh;
    overflow: auto;
    padding: 1.4rem 1.5rem 1.6rem;
    animation: pop-in var(--dur-base) var(--ease-spring);
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--espresso);
  }
  .close {
    background: transparent;
    border: 0;
    color: var(--walnut);
    font-size: 1.6rem;
    line-height: 1;
    padding: 0.1rem 0.4rem;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .close:hover { background: var(--surface); color: var(--espresso); }
  .groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1.2rem 2rem;
  }
  .group h3 {
    margin: 0 0 0.5rem;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--faded);
    font-weight: 600;
  }
  .group ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .group li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.85rem;
  }
  .lbl { color: var(--walnut); }
  .combo {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    flex-shrink: 0;
  }
  .plus { color: var(--faded); font-size: 0.7rem; }
  kbd {
    background: var(--surface);
    border: 1px solid var(--hairline-strong);
    border-bottom-width: 2px;
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.45rem;
    font-size: 0.74rem;
    font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    color: var(--espresso);
    min-width: 1.4em;
    text-align: center;
    line-height: 1.3;
  }
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes pop-in {
    from { transform: scale(0.96); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
</style>
