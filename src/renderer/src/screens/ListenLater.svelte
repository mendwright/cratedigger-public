<script lang="ts">
  import type { ListenLaterEntry } from '../../../shared/plex'
  import { plexState } from '../lib/plex-state.svelte'
  import ScreenHeader from '../lib/ScreenHeader.svelte'
  import { queueMenuItems } from '../lib/queue-menu'

  // Newest-first feels more like a backlog than oldest-first.
  const entries = $derived([...plexState.listenLater].reverse())

  function fmtSince(ts: number): string {
    const elapsed = Date.now() - ts
    const day = 24 * 3600 * 1000
    if (elapsed < day) return 'today'
    if (elapsed < 2 * day) return 'yesterday'
    const days = Math.floor(elapsed / day)
    if (days < 30) return `${days}d ago`
    const months = Math.floor(days / 30)
    if (months < 12) return `${months}mo ago`
    return `${Math.floor(months / 12)}y ago`
  }

  function open(e: ListenLaterEntry): void {
    void plexState.openAlbumDetail(e.ratingKey)
  }

  function onCtx(ev: MouseEvent, e: ListenLaterEntry): void {
    ev.preventDefault()
    plexState.openContextMenu(ev.clientX, ev.clientY, [
      { label: 'Play Now', onClick: () => void plexState.playback.requestCastAlbum(e.ratingKey, e.title, e.artist) },
      ...queueMenuItems('album', e.ratingKey, e.title, e.artist),
      { separator: true },
      { label: 'Remove from later', onClick: () => void plexState.toggleListenLater({ ratingKey: e.ratingKey, title: e.title, artist: e.artist, thumb: e.thumb, year: e.year }) }
    ])
  }
</script>

<div class="page">
  <ScreenHeader
    --screen-header-bleed="2rem"
    --screen-header-gap="1.1rem"
    --screen-header-max="1100px"
    onback={() => plexState.closeListenLater()}
    kicker="queue"
    title="Listen Later"
    sub={entries.length > 0
      ? `${entries.length} album${entries.length === 1 ? '' : 's'} saved`
      : ''}
  />

  {#if entries.length === 0}
    <div class="empty">
      <p><strong>Nothing saved yet.</strong></p>
      <p class="hint">
        Right-click any album in the library → <em>Save for later</em> to add it here.
      </p>
    </div>
  {:else}
    <ul class="grid">
      {#each entries as e (e.ratingKey)}
        {@const src = plexState.thumbUrl(e.thumb, 320, e.ratingKey)}
        <li>
          <button
            class="card"
            onclick={() => open(e)}
            oncontextmenu={(ev) => onCtx(ev, e)}
          >
            <div class="cover">
              {#if src}
                <img src={src} alt={e.title} loading="lazy" />
              {:else}
                <div class="cover-fallback">{e.title.slice(0, 1)}</div>
              {/if}
            </div>
            <div class="meta">
              <div class="title">{e.title}</div>
              <div class="artist">{e.artist}</div>
              <div class="when">saved {fmtSince(e.addedAt)}</div>
            </div>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .page {
    height: 100%;
    overflow-y: auto;
    /* No top padding — it would pin the sticky ScreenHeader below the
       visible top and open a see-through strip. See ScreenHeader's styles. */
    padding: 0 2rem 4rem;
    box-sizing: border-box;
  }
  .page > * {
    max-width: 1100px;
    margin-left: auto;
    margin-right: auto;
  }
  .empty {
    padding: 3rem 1rem;
    text-align: center;
    color: var(--faded);
  }
  .empty .hint {
    max-width: 540px;
    margin: 0.5rem auto 0;
    font-size: 0.88rem;
    line-height: 1.45;
  }
  .grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1.25rem;
  }
  .card {
    background: transparent;
    border: 0;
    padding: 0;
    text-align: left;
    cursor: pointer;
    color: inherit;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font: inherit;
    width: 100%;
  }
  .cover {
    aspect-ratio: 1;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--hairline);
    box-shadow: 0 6px 20px rgba(var(--shadow-color), 0.18);
    transition: transform 140ms ease, box-shadow 140ms ease;
  }
  .card:hover .cover {
    transform: translateY(-2px);
    box-shadow: 0 12px 28px rgba(var(--shadow-color), 0.28);
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .cover-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--faded);
    font-size: 2.5rem;
    font-weight: 200;
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .title {
    font-size: 0.9rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .artist {
    color: var(--walnut);
    font-size: 0.82rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .when {
    color: var(--faded);
    font-size: 0.72rem;
    margin-top: 0.1rem;
  }
</style>
