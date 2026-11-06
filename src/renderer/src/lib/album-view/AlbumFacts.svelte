<script lang="ts">
  import { plexState } from '../plex-state.svelte'

  // Facts under the cover: key/value rows rather than the `·`-joined stats
  // sentence that used to run under the title, so released / label / format /
  // added / plays each scan on their own line. Shared by album detail and
  // Now Playing — both render it under the art, so it lives here once.
  let { facts }: { facts: { key: string; value: string }[] } = $props()

  // Plex hands us the raw studio string; the label entity is keyed by the
  // canonical name, same as the label pills and the "more from" rail.
  function openLabel(value: string): void {
    plexState.openLabelEntity(plexState.labelAliases.canonical(value))
  }
</script>

{#if facts.length > 0}
  <dl class="facts" data-album-facts>
    {#each facts as f (f.key)}
      <div class="fact">
        <dt>{f.key}</dt>
        <dd>
          {#if f.key === 'label'}
            <button
              type="button"
              class="fact-link"
              onclick={() => openLabel(f.value)}
              title={`See all albums on ${f.value}`}
            >{f.value}</button>
          {:else}
            {f.value}
          {/if}
        </dd>
      </div>
    {/each}
  </dl>
{/if}

<style>
  .facts {
    margin: 1rem 0 0;
    padding-top: 1rem;
    border-top: 1px solid var(--hairline);
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .fact {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
  .fact dt {
    flex: 0 0 74px;
    font-size: 0.78rem;
    text-transform: lowercase;
    letter-spacing: 0.04em;
    color: var(--faded);
  }
  .fact dd {
    margin: 0;
    font-size: 0.78rem;
    color: var(--espresso);
    min-width: 0;
  }
  .fact-link {
    background: transparent;
    border: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    border-bottom: 1px solid transparent;
    transition: color 140ms ease, border-color 140ms ease;
  }
  .fact-link:hover {
    color: var(--brick);
    border-bottom-color: var(--brick);
  }
</style>
