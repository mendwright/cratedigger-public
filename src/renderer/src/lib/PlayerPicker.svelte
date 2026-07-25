<script lang="ts">
  import { plexState } from './plex-state.svelte'
  import { LOCAL_PLAYER_ID, LOCAL_PLAYER_NAME, isLocalPlayerId } from './local-player'

  const players = $derived(plexState.playback.players)
  const activeId = $derived(plexState.playback.activePlayerId)
  const loading = $derived(plexState.playback.playersLoading)
  const error = $derived(plexState.playback.playersError)

  let open = $state(false)
  let rootEl: HTMLDivElement | undefined = $state()

  function toggle(): void {
    if (!open) void plexState.playback.loadPlayers()
    open = !open
  }

  function pick(id: string | null): void {
    plexState.playback.setActivePlayer(id)
    open = false
  }

  function onDocClick(e: MouseEvent): void {
    if (!rootEl || !open) return
    if (!rootEl.contains(e.target as Node)) open = false
  }

  $effect(() => {
    if (open) {
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }
  })

  const activeLabel = $derived(plexState.playback.activePlayerName() ?? 'pick a player')
</script>

<div class="picker" bind:this={rootEl}>
  <button class="trigger" onclick={toggle} aria-haspopup="listbox" aria-expanded={open}>
    <span class="dot" class:active={!!activeId}></span>
    <span class="name">{activeLabel}</span>
    <span class="chev">▾</span>
  </button>

  {#if open}
    <div class="menu" role="listbox">
      <div class="menu-head">
        <span class="label">cast target</span>
        <button class="refresh" onclick={() => plexState.playback.loadPlayers()} disabled={loading}>
          {loading ? 'refreshing…' : 'refresh'}
        </button>
      </div>
      {#if error}
        <div class="err">{error}</div>
      {:else}
        <ul>
          <li>
            <button
              class="item"
              class:selected={!activeId}
              onclick={() => pick(null)}
              role="option"
              aria-selected={!activeId}
            >
              <span class="item-name">none (browsing only)</span>
            </button>
          </li>
          <li>
            <button
              class="item"
              class:selected={isLocalPlayerId(activeId)}
              onclick={() => pick(LOCAL_PLAYER_ID)}
              role="option"
              aria-selected={isLocalPlayerId(activeId)}
            >
              <span class="item-name">{LOCAL_PLAYER_NAME}</span>
              <span class="item-meta">play here · no Plexamp needed</span>
            </button>
          </li>
          {#each players as p (p.clientIdentifier)}
            <li>
              <button
                class="item"
                class:selected={activeId === p.clientIdentifier}
                onclick={() => pick(p.clientIdentifier)}
                role="option"
                aria-selected={activeId === p.clientIdentifier}
              >
                <span class="item-name">{p.name}</span>
                <span class="item-meta">{p.product}{p.platform ? ` · ${p.platform}` : ''}</span>
              </button>
            </li>
          {/each}
          {#if players.length === 0 && !loading}
            <li class="empty">no Plex players found.</li>
          {/if}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    -webkit-app-region: no-drag;
  }
  .trigger {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--inset);
    color: var(--espresso);
    border: 1px solid var(--hairline);
    padding: 0.4rem 0.75rem;
    border-radius: var(--radius-pill);
    font-size: 0.82rem;
    cursor: pointer;
    max-width: 220px;
  }
  .trigger:hover { border-color: var(--hairline-strong); background: var(--surface); }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--whisper);
    flex-shrink: 0;
  }
  .dot.active { background: var(--ok-fg); box-shadow: 0 0 8px rgba(58, 111, 63, 0.55); }
  .name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chev { color: var(--faded); font-size: 0.7rem; }
  .menu {
    position: absolute;
    top: calc(100% + 0.4rem);
    right: 0;
    min-width: 260px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: 0.5rem;
    box-shadow: var(--shadow-lg);
    z-index: 20;
  }
  .menu-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.15rem 0.5rem 0.4rem;
  }
  .label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--faded);
  }
  .refresh {
    background: transparent;
    border: 0;
    color: var(--faded);
    font-size: 0.75rem;
    cursor: pointer;
  }
  .refresh:disabled { color: var(--whisper); cursor: default; }
  ul { list-style: none; padding: 0; margin: 0; }
  .item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    padding: 0.5rem 0.6rem;
    border-radius: var(--radius-md);
    cursor: pointer;
    color: var(--espresso);
  }
  .item:hover { background: var(--ink-tint-04); }
  .item.selected { background: var(--brick-wash); color: var(--brick-deep); }
  .item-name { font-size: 0.88rem; font-weight: 500; }
  .item-meta { font-size: 0.7rem; color: var(--faded); }
  .err { color: var(--err-fg); font-size: 0.8rem; padding: 0.5rem; }
  .empty { color: var(--walnut); font-size: 0.8rem; padding: 0.5rem; line-height: 1.4; }
</style>
