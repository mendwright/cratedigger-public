<script lang="ts">
  import { onMount } from 'svelte'
  import type { MiniPlayerState } from '../../../shared/ipc-contract'

  // The mini window is a dumb terminal: state arrives over IPC from the main
  // window's poll (via main), transport goes back the same way. No PlexState
  // here — a second live instance would double the radio staging logic and
  // couldn't reach the main window's <audio> for local playback anyway.
  let m = $state<MiniPlayerState | null>(null)

  onMount(() => window.cratedigger.mini.onState((s) => (m = s)))

  // Smooth progress between the 2.5s state pushes.
  let tickNow = $state(performance.now())
  let baseTime = 0
  let baseAt = 0

  $effect(() => {
    if (!m) return
    baseTime = m.time
    baseAt = performance.now()
  })

  $effect(() => {
    if (!m || m.state !== 'playing') return
    const id = window.setInterval(() => {
      tickNow = performance.now()
    }, 500)
    return () => clearInterval(id)
  })

  const progress = $derived.by(() => {
    if (!m || !m.duration) return 0
    const t = m.state === 'playing' ? baseTime + (tickNow - baseAt) : baseTime
    return Math.min(1, t / m.duration)
  })

  const playing = $derived(m?.state === 'playing' || m?.state === 'buffering')

  function send(action: 'playPause' | 'next' | 'previous'): void {
    void window.cratedigger.mini.sendCommand({ action })
  }
</script>

<div class="mini">
  {#if m?.thumbUrl}
    <img class="cover" src={m.thumbUrl} alt="" />
  {:else}
    <div class="cover ph"></div>
  {/if}

  <div class="body">
    {#if m && m.title}
      <div class="meta">
        <div class="title">{m.title}</div>
        <div class="sub">{m.artist}</div>
      </div>
    {:else}
      <div class="meta">
        <div class="sub quiet">nothing playing</div>
      </div>
    {/if}

    <div class="controls">
      <button class="ctrl" onclick={() => send('previous')} title="Previous" aria-label="Previous">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="none" aria-hidden="true">
          <polygon points="19 20 9 12 19 4 19 20"></polygon>
          <rect x="4" y="4" width="2.4" height="16" rx="1"></rect>
        </svg>
      </button>
      <button class="ctrl play" onclick={() => send('playPause')} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>
        {#if playing}
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="none" aria-hidden="true">
            <rect x="6" y="4" width="4" height="16" rx="1"></rect>
            <rect x="14" y="4" width="4" height="16" rx="1"></rect>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="none" aria-hidden="true">
            <polygon points="6 4 21 12 6 20 6 4"></polygon>
          </svg>
        {/if}
      </button>
      <button class="ctrl" onclick={() => send('next')} title="Next" aria-label="Next">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="none" aria-hidden="true">
          <polygon points="5 4 15 12 5 20 5 4"></polygon>
          <rect x="17.6" y="4" width="2.4" height="16" rx="1"></rect>
        </svg>
      </button>
    </div>
  </div>

  <div class="corner">
    <button
      class="corner-btn"
      onclick={() => void window.cratedigger.mini.focusMain()}
      title="Open Cratedigger"
      aria-label="Open Cratedigger"
    >
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="21" y1="3" x2="12" y2="12"></line>
      </svg>
    </button>
    <button
      class="corner-btn"
      onclick={() => void window.cratedigger.mini.toggle()}
      title="Close mini player"
      aria-label="Close mini player"
    >
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
        <line x1="5" y1="5" x2="19" y2="19"></line>
        <line x1="19" y1="5" x2="5" y2="19"></line>
      </svg>
    </button>
  </div>

  <div class="rail"><div class="fill" style="width: {progress * 100}%"></div></div>
</div>

<style>
  .mini {
    position: relative;
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: stretch;
    background: var(--paper);
    overflow: hidden;
    -webkit-app-region: drag;
    user-select: none;
  }
  .cover,
  .ph {
    width: 84px;
    height: 84px;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--hairline);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0 0.8rem;
  }
  .meta {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--espresso);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 0.72rem;
    color: var(--faded);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .quiet { font-style: italic; }
  .controls {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }
  .ctrl {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: var(--radius-pill);
    color: var(--espresso);
    cursor: pointer;
  }
  .ctrl:hover { background: var(--hairline); }
  .play {
    background: var(--espresso);
    color: var(--paper);
  }
  .play:hover { background: var(--brick); color: var(--paper); }
  .corner {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 140ms ease;
    -webkit-app-region: no-drag;
  }
  .mini:hover .corner { opacity: 1; }
  .corner-btn {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--paper) 80%, transparent);
    border: 0;
    border-radius: var(--radius-pill);
    color: var(--faded);
    cursor: pointer;
  }
  .corner-btn:hover { color: var(--espresso); background: var(--hairline); }
  .rail {
    position: absolute;
    left: 84px;
    right: 0;
    bottom: 0;
    height: 2px;
    background: var(--ink-tint-08);
  }
  .fill {
    height: 100%;
    background: var(--brick);
    transition: width 500ms linear;
  }
</style>
