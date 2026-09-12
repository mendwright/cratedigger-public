<script lang="ts">
  import { plexState } from '../lib/plex-state.svelte'

  const session = $derived(plexState.session)
  const servers = $derived(plexState.servers)
</script>

<section>
  <header>
    <div>
      <div class="label">signed in as</div>
      <div class="who">{session?.signedIn ? session.user.title || session.user.username : ''}</div>
    </div>
    <button class="secondary" onclick={() => plexState.signOut()}>sign out</button>
  </header>

  <h2>pick a server</h2>

  {#if plexState.serversLoading}
    <p class="hint">loading servers…</p>
  {:else if plexState.serversError}
    <p class="error">{plexState.serversError}</p>
    <button class="secondary" onclick={() => plexState.loadServers()}>retry</button>
  {:else if servers.length === 0}
    <p class="hint">no servers found for this account.</p>
  {:else}
    <ul class="servers">
      {#each servers as server (server.clientIdentifier)}
        {@const isActive = session?.signedIn && session.preferredServerId === server.clientIdentifier}
        <li>
          <button
            class="server"
            class:active={isActive}
            onclick={() => plexState.pickServer(server.clientIdentifier)}
          >
            <div class="name">{server.name}</div>
            <div class="meta">
              {server.product} {server.productVersion}
              · {server.owned ? 'owned' : 'shared'}
              · {server.connections.length} connection{server.connections.length === 1 ? '' : 's'}
            </div>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  section {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 3rem 2.5rem 2rem;
    box-sizing: border-box;
    overflow-y: auto;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    -webkit-app-region: drag;
  }
  .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--faded);
  }
  .who { font-size: 1rem; color: var(--espresso); font-weight: 500; }
  h2 {
    font-size: 1.4rem;
    font-weight: 600;
    margin: 0.5rem 0 0.25rem;
    letter-spacing: -0.01em;
  }
  .servers {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.5rem;
  }
  button {
    -webkit-app-region: no-drag;
    cursor: pointer;
    border: 0;
  }
  .secondary {
    background: transparent;
    color: var(--faded);
    border: 1px solid var(--hairline);
    padding: 0.4rem 0.9rem;
    border-radius: var(--radius-pill);
    font-size: 0.8rem;
  }
  .server {
    width: 100%;
    text-align: left;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-xl);
    padding: 1rem 1.25rem;
    color: var(--espresso);
    transition: border-color 120ms ease, background 120ms ease;
  }
  .server:hover { border-color: var(--whisper); }
  .server.active { border-color: var(--brick); background: var(--brick-deep); }
  .name { font-weight: 600; font-size: 1rem; }
  .meta { font-size: 0.8rem; color: var(--faded); margin-top: 0.2rem; }
  .hint { color: var(--faded); font-size: 0.9rem; }
  .error { color: var(--err-fg); font-size: 0.9rem; }
</style>
