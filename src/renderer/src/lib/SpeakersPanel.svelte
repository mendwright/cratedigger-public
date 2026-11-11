<script lang="ts">
  import { onMount } from 'svelte'
  import { hayesState as hayes } from './hayes-state.svelte'

  let panel: HTMLDivElement
  let trigger: HTMLButtonElement
  let open = $state(false)
  const view = $derived(hayes.snapshot)
  onMount(() => hayes.start())

  function close(): void { open = false; trigger?.focus() }
  function outside(event: MouseEvent): void {
    if (open && !panel.contains(event.target as Node)) open = false
  }
</script>

<svelte:document onmousedown={outside} onkeydown={(event) => {
  if (open && event.key === 'Escape') { event.stopPropagation(); close() }
}} />

<div class="speakers" bind:this={panel}>
  <button class="trigger" aria-label="House speakers" bind:this={trigger} onclick={() => { open = !open; if (open) void hayes.refresh() }} aria-expanded={open} aria-controls="house-speakers" title={hayes.summary}>
    <span class="dot" class:online={hayes.online}></span>speakers ▾
  </button>
  {#if open}
    <section id="house-speakers" class="panel" aria-label="House speakers">
      <header><strong>House speakers</strong><button class="close" onclick={close} aria-label="Close speakers">×</button></header>
      <p class="summary" aria-live="polite">{hayes.summary}</p>
      {#if !hayes.online}
        <p class="notice">Hayes is unavailable. Reconnecting automatically…</p>
      {/if}
      {#if view}
        {#if view.protect}<p class="notice">Speaker protection is on. Switches can be turned off; turning them on is blocked.</p>{/if}
        <button class="row" aria-pressed={view.mains} disabled={!hayes.online || !!hayes.pending || (view.protect && !view.mains)} onclick={() => hayes.setSwitch('mains', !view.mains)}>
          <span><strong>Music amp</strong><small>Luxman R-1040</small></span>
          <span class="switch" class:on={view.mains}>{hayes.pending === 'mains' ? 'Changing…' : view.mains ? 'On' : 'Off'}</span>
        </button>
        <div class="rooms">
          {#each view.zones as zone (zone.id)}
            <button class="row" aria-pressed={zone.on} disabled={!hayes.online || !!hayes.pending || (view.protect && !zone.on)} onclick={() => hayes.setSwitch(zone.id, !zone.on)}>
              <span><strong>{zone.name}</strong><small>{zone.sourceName}{zone.source === 'luxman' && !view.mains ? ' · amp off' : ''}</small></span>
              <span class="switch" class:on={zone.on}>{hayes.pending === zone.id ? 'Changing…' : zone.on ? 'On' : 'Off'}</span>
            </button>
          {/each}
        </div>
        {#if view.zones.some(z => z.source === 'sony')}
          <p class="notice">Living room is routed to Sony for movies.</p>
        {/if}
      {/if}
      {#if hayes.error}<p class="error" role="alert">{hayes.error}</p>{/if}
      <p class="foot">These switches control the house speakers. Choose what plays with the player picker.</p>
    </section>
  {/if}
</div>

<style>
  .speakers { position: relative; -webkit-app-region: no-drag; }
  button { font: inherit; cursor: pointer; color: var(--espresso); }
  .trigger { display: flex; align-items: center; gap: .45rem; padding: .4rem .75rem; font-size: .82rem; border: 1px solid var(--hairline); border-radius: var(--radius-pill); background: var(--inset); white-space: nowrap; }
  .trigger:hover { background: var(--surface); border-color: var(--hairline-strong); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--whisper); }
  .dot.online { background: var(--ok-fg); }
  .panel { box-sizing: border-box; position: absolute; top: calc(100% + .4rem); right: 0; width: min(330px, calc(100vw - 32px)); max-height: calc(100vh - 120px); overflow: auto; padding: 1rem; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--surface); color: var(--espresso); box-shadow: var(--shadow-lg); }
  header { display: flex; align-items: center; justify-content: space-between; }
  header strong { font-size: .95rem; }
  .close { border: 0; background: transparent; font-size: 1.3rem; padding: 0 .3rem; }
  p { font-size: .76rem; line-height: 1.5; margin: .65rem 0; }
  .summary { color: var(--walnut); }
  .row { width: 100%; display: flex; justify-content: space-between; align-items: center; text-align: left; gap: .7rem; padding: .75rem .5rem; background: transparent; border: 0; border-radius: var(--radius-md); }
  .row:hover:enabled { background: var(--ink-tint-04); }
  .row:disabled { cursor: default; opacity: .6; }
  .row strong { display: block; font-size: .84rem; font-weight: 500; }
  small { display: block; font-size: .7rem; color: var(--faded); margin-top: .2rem; }
  .switch { font-size: .72rem; background: var(--ink-tint-06); color: var(--walnut); border-radius: var(--radius-pill); padding: .25rem .65rem; }
  .switch.on { background: var(--ink-tint-06); color: var(--ok-fg); }
  .rooms { border-top: 1px solid var(--hairline); margin-top: .3rem; padding-top: .3rem; }
  .notice { color: var(--walnut); background: var(--ink-tint-06); border-radius: var(--radius-md); padding: .6rem; }
  .error { color: var(--err-fg); }
  .foot { border-top: 1px solid var(--hairline); padding-top: .7rem; color: var(--faded); margin-bottom: 0; }
  button:focus-visible { outline: 2px solid var(--brick); outline-offset: 3px; }
</style>
