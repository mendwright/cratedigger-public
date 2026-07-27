<script lang="ts">
  import { plexState } from '../lib/plex-state.svelte'
  import { isPlexAuthUrl } from '../../../shared/urls'

  const progress = $derived(plexState.authProgress)
  const busy = $derived(
    progress.stage === 'creating-pin' || progress.stage === 'awaiting-claim'
  )
  const safeClaimUrl = $derived(
    progress.stage === 'awaiting-claim' && isPlexAuthUrl(progress.claimUrl) ? progress.claimUrl : null
  )
  const stale = $derived(
    plexState.session && !plexState.session.signedIn ? plexState.session.stale : undefined
  )
</script>

<section>
  <h1>Cratedigger</h1>
  <p class="tag">flip the records. cast the bits. credit the players.</p>

  {#if progress.stage === 'awaiting-claim'}
    <div class="code-card">
      <div class="label">your code</div>
      <div class="code">{progress.code}</div>
      <p class="hint">browser open? if not, {#if safeClaimUrl}<a href={safeClaimUrl} target="_blank" rel="noreferrer">click here</a>{:else}visit plex.tv/link{/if}.</p>
      <button class="secondary" onclick={() => plexState.cancelAuth()}>cancel</button>
    </div>
  {:else if progress.stage === 'creating-pin'}
    <p class="hint">requesting PIN from plex.tv…</p>
  {:else}
    {#if stale}
      <p class="hint">plex.tv stopped accepting {stale.username}'s session — sign in again to refresh it.</p>
    {/if}
    <button class="primary" disabled={busy} onclick={() => plexState.signIn()}>
      sign in with plex
    </button>
    {#if progress.stage === 'error'}
      <p class="error">{progress.message}</p>
    {/if}
  {/if}
</section>

<style>
  section {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 2rem;
    -webkit-app-region: drag;
  }
  h1 {
    font-size: 3rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0;
    background: linear-gradient(90deg, #f0f0f2, var(--faded));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .tag {
    margin: 0 0 1.5rem;
    color: var(--faded);
    font-size: 0.9rem;
  }
  button {
    -webkit-app-region: no-drag;
    border: 0;
    cursor: pointer;
    padding: 0.75rem 1.5rem;
    border-radius: var(--radius-pill);
    font-size: 0.95rem;
    font-weight: 500;
    transition: transform 120ms ease, background 120ms ease;
  }
  button:disabled { opacity: 0.5; cursor: default; }
  .primary {
    background: var(--brick);
    color: var(--inset);
  }
  .primary:not(:disabled):hover { transform: translateY(-1px); }
  .secondary {
    background: transparent;
    color: var(--faded);
    border: 1px solid var(--hairline);
  }
  .code-card {
    -webkit-app-region: no-drag;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-2xl);
    padding: 1.5rem 2.5rem;
  }
  .label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--faded);
  }
  .code {
    font-family: var(--font-mono);
    font-size: 2.5rem;
    font-weight: 700;
    letter-spacing: 0.3em;
    color: var(--brick);
  }
  .hint { color: var(--faded); font-size: 0.85rem; margin: 0; }
  .hint a { color: var(--brick); }
  .error { color: var(--err-fg); font-size: 0.85rem; margin: 0; }
</style>
