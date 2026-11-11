<script lang="ts">
  import { plexState } from '../plex-state.svelte'
  import type { ChartEntry, ChartDimension } from '../../../../shared/charts'
  let { entry, dimension, eager = false }: { entry: ChartEntry; dimension: ChartDimension; eager?: boolean } = $props()
  let extra = $state<string[]>([])
  let failed = $state<string[]>([])
  // URLs this card has seen finish loading. Never cleared on a data refresh:
  // a cached chart swapped for the fresh one keeps the same URL, the <img>
  // doesn't fire load again, and a reset here left the cover hidden forever.
  let loaded = $state<string[]>([])
  function markLoaded(img: HTMLImageElement): void {
    const url = img.getAttribute('src')
    if (url && img.naturalWidth > 0 && !loaded.includes(url)) loaded = [...loaded, url]
  }
  // Covers the cache-hit case where the image is already complete on mount.
  function seen(img: HTMLImageElement) {
    if (img.complete) markLoaded(img)
    return {}
  }
  let fallback: (force?: boolean) => void = () => {}
  let host: HTMLDivElement
  const sources = $derived([...new Set([
    plexState.thumbUrl(entry.thumb, 600),
    ...extra.filter(url => url.startsWith('/')).map(url => plexState.thumbUrl(url, 600)),
    entry.art,
    ...extra.filter(url => !url.startsWith('/'))
  ].filter((s): s is string => !!s))])
  const src = $derived(sources.find(url => !failed.includes(url)))
  const ready = $derived(!!src && loaded.includes(src))
  $effect(() => {
    const item = $state.snapshot(entry)
    const dim = dimension
    extra = []; failed = []
    let active = true
    let started = false
    const load = (force = false): void => {
      if (started || (!force && dim !== 'artists' && (item.thumb || item.art))) return
      started = true
      void window.cratedigger.charts.art(item, dim).then(urls => { if (active) extra = urls }).catch(() => {})
    }
    fallback = load
    if (eager) load()
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { load(); observer.disconnect() } }, { rootMargin: '300px' })
    observer.observe(host)
    return () => { active = false; observer.disconnect() }
  })
</script>
<div class="image" bind:this={host}>
  <div class="placeholder" class:covered={ready} aria-hidden={ready} aria-label={src ? 'Artwork loading' : 'Artwork unavailable'}>
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="disc" cx="50" cy="50" r="38"/><circle cx="50" cy="50" r="29"/><circle cx="50" cy="50" r="20"/><circle class="label" cx="50" cy="50" r="11"/><circle class="hole" cx="50" cy="50" r="3"/></svg>
  </div>
  {#if src}
    {#key src}<img src={src} class:ready alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" use:seen onload={(e) => markLoaded(e.currentTarget as HTMLImageElement)} onerror={() => { if (src) failed = [...failed, src]; fallback(true) }} />{/key}
  {/if}
</div>
<style>
  .image { position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--surface); border-radius: inherit; }
  img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; visibility: hidden; }
  img.ready { visibility: visible; }
  .placeholder { position: absolute; inset: 0; display: grid; place-items: center; background: color-mix(in srgb, var(--espresso) 12%, var(--surface)); }
  .placeholder.covered { visibility: hidden; }
  svg { width: 80%; height: 80%; fill: none; stroke: var(--faded); stroke-width: 2; }
  .disc { fill: var(--surface); }
  .label { fill: var(--brick); stroke: none; }
  .hole { fill: var(--surface); stroke: none; }
</style>
