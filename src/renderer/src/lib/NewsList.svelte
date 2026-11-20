<script lang="ts">
  import { plexState } from './plex-state.svelte'

  const d = plexState.discover
  const shown = $derived(d.newsHighlightedOnly ? d.news.filter((s) => s.artists.length > 0) : d.news)
  // Captured once per visit so stories that arrived since last time keep
  // their "new" mark while you read, even though opening clears the dot.
  const seenBefore = d.newsSeenAt

  $effect(() => {
    void d.loadNews()
    d.markNewsSeen()
  })

  function when(ts: number | null | undefined): string {
    if (!ts) return ''
    const days = Math.floor((Date.now() - ts) / 86_400_000)
    if (days <= 0) return 'today'
    if (days === 1) return 'yesterday'
    if (days < 7) return `${days} days ago`
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  function openArtist(name: string): void {
    void plexState.openArtistByName(name)
  }
</script>

<div class="bar">
  <label class="toggle">
    <input type="checkbox" bind:checked={d.newsHighlightedOnly} />
    only stories about your artists
  </label>
  <span class="count">{shown.length} {shown.length === 1 ? 'story' : 'stories'} · last 30 days</span>
</div>

{#if d.newsAvailable === false}
  <div class="empty"><p>News comes from the tagger, and this Mac can't reach it right now.</p></div>
{:else if d.newsLoading}
  <div class="empty"><p>Loading…</p></div>
{:else if shown.length === 0}
  <div class="empty"><p>No stories about your artists this month.</p></div>
{:else}
  <ul class="stories">
    {#each shown as s (s.id)}
      <li class:fresh={s.artists.length > 0 && (s.firstSeen ?? s.date ?? 0) > seenBefore}>
        <button class="story" onclick={() => plexState.openBrowserPaneAt(s.url)} title="Open the story">
          {#if s.image}
            <img src={s.image} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
          {:else}
            <span class="noimg"></span>
          {/if}
          <span class="body">
            <span class="meta">{s.source} · {when(s.date ?? s.firstSeen)}</span>
            <span class="title">{s.title}</span>
            {#if s.summary}<span class="summary">{s.summary}</span>{/if}
          </span>
        </button>
        {#if s.artists.length > 0}
          <span class="artists">
            {#each s.artists as a (a)}
              <button class="artist" onclick={() => openArtist(a)} title="Open {a} in your library">{a}</button>
            {/each}
          </span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin: 0.25rem 0 1rem;
    font-size: 0.8rem;
    color: var(--faded);
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--walnut);
    cursor: pointer;
  }
  .stories {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
  }
  li {
    border-bottom: 1px solid var(--hairline);
    padding: 0.85rem 0;
  }
  .story {
    display: grid;
    grid-template-columns: 112px 1fr;
    gap: 1rem;
    width: 100%;
    background: none;
    border: 0;
    padding: 0;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }
  .story img,
  .noimg {
    width: 112px;
    height: 74px;
    object-fit: cover;
    border-radius: 6px;
    background: var(--inset);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .meta {
    font-size: 0.72rem;
    color: var(--faded);
    letter-spacing: 0.02em;
  }
  .title {
    font-weight: 600;
    color: var(--espresso);
    line-height: 1.3;
  }
  .story:hover .title {
    text-decoration: underline;
    text-decoration-color: var(--hairline-strong);
  }
  .summary {
    font-size: 0.8rem;
    color: var(--walnut);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .fresh .meta::before {
    content: 'new · ';
    color: var(--brick);
    font-weight: 600;
  }
  .artists {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: 0.5rem 0 0 calc(112px + 1rem);
  }
  .artist {
    background: var(--crate-mustard);
    color: var(--on-brick);
    border: 0;
    border-radius: var(--radius-pill);
    padding: 0.16rem 0.6rem;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
  }
  .empty {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--faded);
  }
</style>
