<script lang="ts">
  import { onMount } from 'svelte'
  import type { UpdateState } from '../../../shared/updates'

  // localStorage key intentionally still 'sideman.*' through the Cratedigger
  // rename — renaming would lose the user's per-version dismissal state.
  const DISMISS_KEY = 'sideman.dismissedUpdateVersion'

  let view = $state<UpdateState>({ status: 'idle' })
  let dismissed = $state(false)
  let detach: (() => void) | null = null

  onMount(() => {
    void window.cratedigger.updates.getState().then((s) => {
      view = s
    })
    detach = window.cratedigger.updates.onState((s) => {
      view = s
      // A fresher available/downloaded supersedes any prior dismissal for an
      // older latest — re-show the banner.
      const latest = 'latest' in s ? s.latest : null
      const skipped = localStorage.getItem(DISMISS_KEY)
      if (latest && skipped !== latest) dismissed = false
    })
    return () => {
      detach?.()
    }
  })

  const latest = $derived(
    view.status === 'available' ||
      view.status === 'downloading' ||
      view.status === 'downloaded'
      ? view.latest
      : null
  )
  const current = $derived(
    view.status === 'available' ||
      view.status === 'downloading' ||
      view.status === 'downloaded'
      ? view.current
      : null
  )
  const skipped = $derived(latest ? localStorage.getItem(DISMISS_KEY) === latest : false)
  const visible = $derived(latest !== null && !dismissed && !skipped)

  function dismiss(): void {
    if (latest) localStorage.setItem(DISMISS_KEY, latest)
    dismissed = true
  }

  async function restart(): Promise<void> {
    try {
      await window.cratedigger.updates.installAndRestart()
    } catch {
      // ignore
    }
  }
</script>

{#if visible}
  <div class="update-banner" role="status">
    {#if view.status === 'downloaded'}
      <span class="msg">
        Cratedigger <strong>v{latest}</strong> is ready to install.
        You're on v{current}.
      </span>
      <button class="primary" onclick={restart}>Restart</button>
    {:else if view.status === 'downloading'}
      <span class="msg">
        Downloading Cratedigger <strong>v{latest}</strong>… {view.percent}%
      </span>
    {:else}
      <span class="msg">
        Cratedigger <strong>v{latest}</strong> is available.
      </span>
    {/if}
    <button class="ghost" onclick={dismiss} aria-label="Dismiss">×</button>
  </div>
{/if}

<style>
  .update-banner {
    position: fixed;
    top: 0.75rem;
    right: 0.75rem;
    z-index: 200;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-md);
    color: var(--espresso);
    font-size: 0.85rem;
    max-width: 28rem;
  }
  .msg { line-height: 1.3; }
  button {
    border: none;
    border-radius: var(--radius-md);
    padding: 0.35rem 0.7rem;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .primary {
    background: var(--accent, #c98b3a);
    color: white;
    font-weight: 600;
  }
  .primary:hover { filter: brightness(1.05); }
  .ghost {
    background: transparent;
    color: var(--faded);
    font-size: 1.1rem;
    line-height: 1;
    padding: 0.15rem 0.4rem;
  }
  .ghost:hover { color: var(--espresso); }
</style>
