<script lang="ts">
  import type { DiscoverPick } from '../../../shared/discover'
  import { pickReason } from '../../../shared/discover'
  import { plexState } from '../lib/plex-state.svelte'
  import ScreenHeader from '../lib/ScreenHeader.svelte'

  const d = plexState.discover
  let imgFailed = $state<Record<string, true>>({})

  function open(p: DiscoverPick): void {
    // The artist page handles artists you don't own: bio, and their albums
    // under "not on your server" with the Soulseek / watchlist buttons.
    if (p.mbid) void plexState.openEntity(p.mbid, p.artist)
    else plexState.openBrowserPaneAt(`https://www.last.fm/music/${encodeURIComponent(p.artist)}`)
  }

  function initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  }

  function fmtBuilt(ts: number | null): string {
    if (!ts) return ''
    return `Picked ${new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} from your last two years of listening`
  }
</script>

<div class="page">
  <ScreenHeader
    --screen-header-bleed="2rem"
    --screen-header-gap="1.1rem"
    --screen-header-max="1200px"
    onback={() => plexState.goHome()}
    kicker="discovery"
    title="Discover"
    sub={d.building && d.picks.length ? 'Rebuilding…' : fmtBuilt(d.builtAt)}
  >
    {#snippet actions()}
      <div class="seg" role="group" aria-label="How far out">
        <button class:active={d.depth === 'close'} aria-pressed={d.depth === 'close'} onclick={() => d.setDepth('close')} title="Close to what you play">close</button>
        <button class:active={d.depth === 'deeper'} aria-pressed={d.depth === 'deeper'} onclick={() => d.setDepth('deeper')} title="Skips the obvious picks and goes a step further out">deeper</button>
      </div>
    {/snippet}
  </ScreenHeader>

  {#if d.error}
    <p class="note err">{d.error}</p>
  {/if}

  {#if d.available === false}
    <div class="empty">
      <p><strong>Discover needs the tagger and your listening history.</strong></p>
      <p class="hint">It's built on the server from what you've played. This Mac can't reach the tagger, or this account has no history there.</p>
    </div>
  {:else if d.picks.length === 0 && (d.building || d.loading)}
    <div class="empty">
      <p><strong>Finding artists for you…</strong></p>
      <p class="hint">The first build looks up a few hundred artists and takes a few minutes. This page fills in when it's done.</p>
    </div>
  {:else if d.picks.length === 0 && d.available}
    <div class="empty">
      <p><strong>No picks yet.</strong></p>
      <button class="primary" onclick={() => void d.rebuild()}>Build now</button>
    </div>
  {:else}
    <ul class="grid">
      {#each d.picks as p (p.artist)}
        <li class="card">
          <button class="open" onclick={() => open(p)} title={p.mbid ? `Open ${p.artist}` : `${p.artist} on Last.fm`}>
            <div class="pic">
              {#if p.image && !imgFailed[p.artist]}
                <img src={p.image} alt="" loading="lazy" onerror={() => (imgFailed = { ...imgFailed, [p.artist]: true })} />
              {:else}
                <span class="initials">{initials(p.artist)}</span>
              {/if}
            </div>
            <span class="name">{p.artist}</span>
            <span class="why">{pickReason(p)}</span>
          </button>
          <button class="hide" onclick={() => void d.hide(p)} title="Not for me — never show {p.artist} again" aria-label="Not for me">×</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .page {
    height: 100%;
    overflow-y: auto;
    padding: 0 2rem 4rem;
    box-sizing: border-box;
  }
  .page > * {
    max-width: 1200px;
    margin-left: auto;
    margin-right: auto;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .seg button {
    background: transparent;
    border: 0;
    color: var(--walnut);
    padding: 0.34rem 0.85rem;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .seg button.active {
    background: var(--crate-mustard);
    color: var(--on-brick);
    font-weight: 600;
  }
  .grid {
    list-style: none;
    padding: 0;
    margin-top: 0.5rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 1.4rem 1.1rem;
  }
  .card {
    position: relative;
  }
  .open {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
    width: 100%;
    background: none;
    border: 0;
    padding: 0;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }
  .pic {
    width: 100%;
    aspect-ratio: 1;
    border-radius: var(--radius-xl, 10px);
    overflow: hidden;
    background: var(--inset);
    display: grid;
    place-items: center;
    box-shadow: 0 1px 0 var(--hairline);
    transition: transform 140ms ease;
  }
  .open:hover .pic {
    transform: translateY(-2px);
  }
  .pic img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .initials {
    font-family: var(--font-display);
    font-size: 1.8rem;
    color: var(--faded);
  }
  .name {
    margin-top: 0.25rem;
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--espresso);
    line-height: 1.2;
  }
  .why {
    font-size: 0.74rem;
    color: var(--faded);
    line-height: 1.3;
  }
  .hide {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 0;
    background: color-mix(in srgb, var(--paper) 80%, transparent);
    color: var(--walnut);
    font-size: 0.95rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .card:hover .hide,
  .hide:focus-visible {
    opacity: 1;
  }
  .empty {
    text-align: center;
    padding: 4rem 1rem;
    color: var(--walnut);
  }
  .hint {
    color: var(--faded);
    max-width: 34rem;
    margin: 0.5rem auto 0;
    line-height: 1.5;
  }
  .primary {
    margin-top: 1rem;
    background: var(--brick);
    color: var(--on-brick);
    border: 0;
    padding: 0.5rem 1.2rem;
    border-radius: var(--radius-pill);
    font-weight: 600;
    cursor: pointer;
  }
  .note.err {
    color: var(--brick);
    font-size: 0.85rem;
  }
</style>
