<script lang="ts">
  import { plexState } from './plex-state.svelte'

  const menu = $derived(plexState.contextMenu)

  let el = $state<HTMLDivElement | null>(null)
  let pos = $state<{ left: number; top: number } | null>(null)

  $effect(() => {
    if (!menu || !el) {
      pos = null
      return
    }
    const margin = 8
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = menu.x
    let top = menu.y
    if (left + rect.width + margin > vw) left = vw - rect.width - margin
    if (top + rect.height + margin > vh) top = vh - rect.height - margin
    pos = { left: Math.max(margin, left), top: Math.max(margin, top) }
  })

  function onWindowMouseDown(e: MouseEvent): void {
    if (!menu) return
    if (el && e.target instanceof Node && el.contains(e.target)) return
    plexState.closeContextMenu()
  }

  function onKey(e: KeyboardEvent): void {
    if (!menu) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      plexState.closeContextMenu()
    }
  }

  function activate(item: { onClick: () => void; disabled?: boolean }): void {
    if (item.disabled) return
    item.onClick()
    plexState.closeContextMenu()
  }
</script>

<svelte:window onmousedown={onWindowMouseDown} onkeydown={onKey} />

{#if menu}
  <div
    class="menu"
    bind:this={el}
    style={pos ? `left: ${pos.left}px; top: ${pos.top}px;` : `left: ${menu.x}px; top: ${menu.y}px; visibility: hidden;`}
    role="menu"
  >
    {#each menu.items as item, i (i)}
      {#if item.separator}
        <div class="sep" role="separator"></div>
      {:else}
        <button
          class="item"
          role="menuitem"
          disabled={item.disabled}
          onclick={() => activate(item)}
        >
          {item.label}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 200;
    min-width: 180px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: 0.3rem;
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    animation: menu-in 90ms ease-out;
  }
  @keyframes menu-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .item {
    background: transparent;
    border: 0;
    color: var(--espresso);
    font-size: 0.88rem;
    text-align: left;
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font: inherit;
  }
  .item:not(:disabled):hover { background: var(--brick-wash); color: var(--brick-deep); }
  .item:disabled { color: var(--faded); cursor: default; }
  .item:focus-visible { outline: 2px solid var(--brick); outline-offset: -2px; }
  .sep {
    height: 1px;
    background: var(--hairline);
    margin: 0.25rem 0.4rem;
  }
</style>
