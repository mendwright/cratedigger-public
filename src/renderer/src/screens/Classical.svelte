<script lang="ts">
  import { onMount } from 'svelte'
  import type { ClassicalEntitySummary, ClassicalWorkSummary } from '../../../shared/classical-api'
  import { isClassicalCandidate } from '../../../shared/classical-model'
  import { ClassicalController } from '../lib/classical-controller.svelte'
  import { plexState } from '../lib/plex-state.svelte'
  import BackButton from '../lib/BackButton.svelte'

  const classical = new ClassicalController()
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  const albumsByKey = $derived(new Map(plexState.allLibraryAlbums().map((album) => [album.ratingKey, album])))

  onMount(() => {
    const stopProgress = window.cratedigger.classical.onSyncProgress((status) => { classical.sync = status })
    const stopChanges = window.cratedigger.classical.onCatalogChanged(() => { void classical.load() })
    void (async () => {
      const albums = await plexState.classicalLibraryAlbums()
      const serverId = plexState.session?.signedIn ? plexState.session.preferredServerId : null
      await window.cratedigger.classical.syncOwnedAlbums({ albums: albums.map((album) => ({
        plexServerId: serverId,
        ratingKey: album.ratingKey,
        title: album.title,
        artist: album.artist,
        year: album.year,
        thumb: album.thumb,
        candidate: isClassicalCandidate(album)
      })) })
      await classical.load()
    })()
    return () => { stopProgress(); stopChanges(); if (searchTimer) clearTimeout(searchTimer) }
  })

  function scheduleSearch(): void {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void classical.search(), 160)
  }

  function openEntity(entity: ClassicalEntitySummary): void {
    if (entity.kind === 'composer') void classical.openComposer(entity.id)
    else if (entity.kind === 'work') void classical.openWork(entity.id)
    else if (entity.kind === 'release') void classical.openRelease(entity.id)
    else if (entity.kind === 'performer' || entity.kind === 'ensemble') void classical.openAgent(entity.id)
  }

  function albumTitle(ratingKey: string): string {
    return albumsByKey.get(ratingKey)?.title ?? `Plex release ${ratingKey}`
  }

  function groupedWorks(works: ClassicalWorkSummary[]): Array<[string, ClassicalWorkSummary[]]> {
    const groups = new Map<string, ClassicalWorkSummary[]>()
    for (const work of works) {
      const genre = work.genre ?? 'Other'
      const group = groups.get(genre)
      if (group) group.push(work)
      else groups.set(genre, [work])
    }
    return [...groups]
  }
</script>

<div class="page">
  <header>
    <BackButton onclick={() => plexState.closeClassical()} />
    <div>
      <p class="eyebrow">Classical workspace</p>
      <h1>Classical</h1>
    </div>
    <nav>
      {#if classical.work}<button onclick={() => classical.showComposer()}>← {classical.composer?.title ?? 'catalog'}</button>{/if}
      {#if classical.composer || classical.work || classical.agent || classical.release}<button onclick={() => classical.showHome()}>catalog</button>{/if}
    </nav>
  </header>

  {#if classical.error}<div class="notice error">{classical.error}</div>{/if}

  {#if classical.agent}
    <section class="detail">
      <p class="kind">{classical.agent.kind}{classical.agent.roles.length ? ` · ${classical.agent.roles.join(' · ')}` : ''}</p>
      <h2>{classical.agent.title}</h2>
      {#if classical.agent.aliases.length}<p class="lede">Also known as {classical.agent.aliases.join(', ')}</p>{/if}
      <div class="stats compact"><span><strong>{classical.agent.releases.length}</strong> releases</span><span><strong>{classical.agent.works.length}</strong> works</span></div>
      {#if classical.agent.works.length}<h3>Works performed</h3><div class="work-list">{#each classical.agent.works as work}<button onclick={() => void classical.openWork(work.id)}><strong>{work.title}</strong><small>{work.genre ?? ''}</small></button>{/each}</div>{/if}
      <h3>Owned appearances</h3>
      <div class="release-grid">{#each classical.agent.releases as release}<button onclick={() => void plexState.openAlbumDetail(release.plexRatingKey)}><span><strong>{albumTitle(release.plexRatingKey)}</strong><small>{release.year ?? ''}</small></span></button>{/each}</div>
    </section>
  {:else if classical.release}
    <section class="detail">
      <p class="kind">owned release · {classical.release.year ?? 'year unknown'}</p>
      <h2>{albumTitle(classical.release.plexRatingKey)}</h2>
      <p class="lede">{classical.release.subtitle ?? ''}</p>
      <button class="open-album" onclick={() => void plexState.openAlbumDetail(classical.release!.plexRatingKey)}>Open album</button>
      <h3>Program</h3>
      <div class="work-list">
        {#each classical.release.program as item}
          <button onclick={() => void classical.openWork(item.work.id)}><strong>{item.work.title}</strong><small>{item.composers.map((composer) => composer.title).join(' · ')} · {item.trackKeys.length} tracks</small></button>
        {/each}
      </div>
      {#if classical.release.credits.length}<h3>Credits</h3><div class="credits">{#each classical.release.credits as credit}<button onclick={() => void classical.openAgent(credit.agent.id)}><span>{credit.role}{credit.instrument ? ` · ${credit.instrument}` : ''}</span><strong>{credit.agent.title}</strong></button>{/each}</div>{/if}
    </section>
  {:else if classical.work}
    <section class="detail">
      <p class="kind">work{classical.work.genre ? ` · ${classical.work.genre}` : ''}</p>
      <h2>{classical.work.title}</h2>
      {#if classical.work.subtitle}<p class="lede">{classical.work.subtitle}</p>{/if}
      <div class="byline">
        {#each classical.work.composers as composer}
          <button onclick={() => void classical.openComposer(composer.id)}>{composer.title}</button>
        {/each}
        {#if classical.work.catalogueNumber}<span>{classical.work.catalogueNumber}</span>{/if}
      </div>
      {#if classical.work.parents.length}
        <div class="relations"><span>part of</span>{#each classical.work.parents as parent}<button onclick={() => void classical.openWork(parent.id)}>{parent.title}</button>{/each}</div>
      {/if}
      {#if classical.work.children.length}
        <h3>Parts & movements</h3>
        <div class="work-list">{#each classical.work.children as child}<button onclick={() => void classical.openWork(child.id)}><strong>{child.title}</strong><small>{child.subtitle ?? ''}</small></button>{/each}</div>
      {/if}
      <h3>Owned renditions <span>{classical.work.ownedCount}</span></h3>
      {#if classical.work.releases.length}
        <div class="release-grid">
          {#each classical.work.releases as release}
            <button onclick={() => void plexState.openAlbumDetail(release.plexRatingKey)}>
              {#if albumsByKey.get(release.plexRatingKey)?.thumb}<img src={plexState.thumbUrl(albumsByKey.get(release.plexRatingKey)?.thumb ?? null, 180, release.plexRatingKey) ?? ''} alt="" />{/if}
              <span><strong>{albumTitle(release.plexRatingKey)}</strong><small>{release.year ?? ''}</small></span>
            </button>
          {/each}
        </div>
      {:else}<p class="empty">No owned recording of this work yet.</p>{/if}
    </section>
  {:else if classical.composer}
    <section class="detail">
      <p class="kind">composer{classical.composer.period ? ` · ${classical.composer.period}` : ''}</p>
      <h2>{classical.composer.title}</h2>
      <p class="lede">{classical.composer.birth?.slice(0,4) ?? ''}{classical.composer.birth || classical.composer.death ? '–' : ''}{classical.composer.death?.slice(0,4) ?? ''}</p>
      <div class="stats compact"><span><strong>{classical.composer.works.length}</strong> {classical.composer.works.length === 1 ? 'work' : 'works'}</span><span><strong>{classical.composer.ownedCount}</strong> owned {classical.composer.ownedCount === 1 ? 'release' : 'releases'}</span></div>
      {#each groupedWorks(classical.composer.works) as [genre, works]}
        <h3>{genre}</h3>
        <div class="work-list">
          {#each works as work (work.id)}
            <button class:owned={work.ownedCount > 0} onclick={() => void classical.openWork(work.id)}>
              <strong>{work.title}</strong><small>{work.subtitle ?? ''}{work.ownedCount ? ` · ${work.ownedCount} owned` : ''}</small>
            </button>
          {/each}
        </div>
      {/each}
    </section>
  {:else if classical.home}
    <div class="stats">
      <span><strong>{classical.home.stats.composers.toLocaleString()}</strong> composers</span>
      <span><strong>{classical.home.stats.works.toLocaleString()}</strong> works</span>
      <span><strong>{classical.home.stats.recordings.toLocaleString()}</strong> owned recordings</span>
      <span><strong>{classical.home.stats.ownedReleases.toLocaleString()}</strong> releases</span>
    </div>
    <div class="search-row">
      <input bind:value={classical.query} oninput={scheduleSearch} placeholder="Composer, work, performer, catalogue number…" aria-label="Search classical catalog" />
      <select bind:value={classical.kind} onchange={scheduleSearch} aria-label="Entity type"><option value={null}>everything</option><option value="composer">composers</option><option value="work">works</option><option value="performer">performers</option><option value="ensemble">ensembles</option></select>
      <label><input type="checkbox" bind:checked={classical.ownedOnly} onchange={scheduleSearch} /> owned</label>
    </div>

    {#if classical.results}
      <p class="result-count">{classical.results.total.toLocaleString()} results</p>
      <div class="results">
        {#each classical.results.items as item (item.id)}
          <button onclick={() => openEntity(item)}><span class="result-kind">{item.kind}</span><strong>{item.title}</strong><small>{item.subtitle ?? item.genre ?? item.period ?? ''}{item.ownedCount ? ` · ${item.ownedCount} owned` : ''}</small></button>
        {/each}
      </div>
      {#if classical.results.nextCursor}<button class="more" onclick={() => void classical.search(false)}>more</button>{/if}
    {:else}
      {#if classical.home.ownedComposers.length}
        <h3>Your composers</h3>
        <div class="composer-grid">{#each classical.home.ownedComposers as composer}<button onclick={() => void classical.openComposer(composer.id)}><strong>{composer.title}</strong><small>{composer.ownedCount} owned {composer.ownedCount === 1 ? 'release' : 'releases'}</small></button>{/each}</div>
      {/if}
      <h3>Explore the repertoire</h3>
      <div class="facets">
        {#each classical.home.periods as period}<button onclick={() => { classical.period = period.name; classical.kind = 'composer'; void classical.search() }}>{period.name}<small>{period.count.toLocaleString()} composers</small></button>{/each}
      </div>
      <div class="facets genres">
        {#each classical.home.genres as genre}<button onclick={() => { classical.genre = genre.name; classical.kind = 'work'; void classical.search() }}>{genre.name}<small>{genre.count.toLocaleString()} works</small></button>{/each}
      </div>
      <div class="composer-grid featured">{#each classical.home.featuredComposers as composer}<button onclick={() => void classical.openComposer(composer.id)}><strong>{composer.title}</strong><small>{composer.period ?? ''}</small></button>{/each}</div>
    {/if}

    <footer>
      <span>{classical.sync?.usable ? 'Catalog ready' : 'Preparing catalog'}{classical.home.sourceVersion ? ` · Open Opus ${classical.home.sourceVersion}` : ''}</span>
      <span>{classical.sync?.current ?? `${classical.sync?.completed ?? 0} complete · ${classical.sync?.pending ?? 0} queued`}</span>
      <span class="sync-actions"><button onclick={() => void classical.toggleSync()}>{classical.sync?.phase === 'paused' ? 'resume' : 'pause'}</button>{#if classical.sync?.failed}<button onclick={() => void classical.retrySync()}>retry {classical.sync.failed}</button>{/if} · {classical.review.length} need review</span>
    </footer>
    {#if classical.review.length}
      <details class="review"><summary>Review uncertain matches ({classical.review.length})</summary>{#each classical.review as candidate}<article><div><strong>{candidate.subject.title}</strong>{#if candidate.candidate}<span> ↔ {candidate.candidate.title}</span>{/if}<small>{candidate.evidence.join(' · ')} · {Math.round(candidate.confidence * 100)}%</small></div><div><button onclick={() => void classical.acceptCandidate(candidate.id)}>merge</button><button onclick={() => void classical.dismissCandidate(candidate.id)}>keep separate</button></div></article>{/each}</details>
    {/if}
  {:else if classical.loading}<div class="empty">Opening the classical catalog…</div>{/if}
</div>

<style>
  .page { width:100%; height:100%; max-width:1120px; margin:0 auto; padding:2rem 2rem 7rem; box-sizing:border-box; overflow-y:auto; }
  header { display:flex; align-items:center; gap:0.85rem; margin-bottom:1.25rem; }
  h1 { margin:0; font-family:var(--font-display); font-size:3rem; color:var(--espresso); }
  h2 { margin:.2rem 0; font-family:var(--font-display); font-size:2.2rem; color:var(--espresso); }
  h3 { margin:2rem 0 .65rem; color:var(--espresso); font-size:.88rem; text-transform:uppercase; letter-spacing:.08em; }
  h3 span { color:var(--faded); font-weight:400; }
  .eyebrow,.kind { margin:0 0 .15rem; color:var(--brick); text-transform:uppercase; letter-spacing:.14em; font-size:.68rem; }
  nav { margin-left:auto; display:flex; gap:.4rem; } nav button,.byline button,.relations button { background:none; border:0; color:var(--faded); cursor:pointer; }
  .stats { display:flex; flex-wrap:wrap; gap:.6rem; margin-bottom:1rem; }.stats span { padding:.45rem .75rem; border:1px solid var(--hairline); border-radius:var(--radius-pill); color:var(--faded); font-size:.78rem; }.stats strong { color:var(--espresso); }.stats.compact { margin-top:1rem; }
  .search-row { display:grid; grid-template-columns:1fr auto auto; gap:.55rem; align-items:center; }.search-row>input,.search-row select { box-sizing:border-box; padding:.8rem 1.1rem; background:var(--surface); border:1px solid var(--hairline); border-radius:var(--radius-pill); color:var(--espresso); font:inherit; }.search-row label { color:var(--faded); font-size:.76rem; }
  .result-count { color:var(--faded); font-size:.72rem; }.results { display:grid; grid-template-columns:repeat(auto-fill,minmax(270px,1fr)); gap:.5rem; }.results button,.composer-grid button,.facets button,.work-list button { text-align:left; padding:.8rem; background:var(--ink-tint-03); border:1px solid var(--hairline); border-radius:var(--radius-md); color:var(--espresso); cursor:pointer; }.results button:hover,.composer-grid button:hover,.work-list button:hover { border-color:var(--brick); background:var(--brick-wash); }.result-kind { display:block; color:var(--brick); font-size:.58rem; text-transform:uppercase; letter-spacing:.1em; }.results strong,.composer-grid strong,.work-list strong { display:block; }.results small,.composer-grid small,.work-list small,.facets small { display:block; margin-top:.2rem; color:var(--faded); font-size:.7rem; }.more { margin:1rem auto; display:block; }
  .composer-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:.5rem; }.composer-grid.featured { margin-top:1rem; }.facets { display:flex; flex-wrap:wrap; gap:.4rem; }.facets button { min-width:130px; }.work-list { display:grid; gap:.35rem; }.work-list button.owned { border-left:3px solid var(--brick); }
  .facets.genres { margin-top:.5rem; }
  .lede { color:var(--faded); margin:.4rem 0; }.byline,.relations { display:flex; gap:.5rem; align-items:center; color:var(--faded); font-size:.78rem; }.byline button { color:var(--brick); padding:0; }.relations { margin-top:1.2rem; }
  .release-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:.55rem; }.release-grid button { display:flex; align-items:center; gap:.7rem; text-align:left; padding:.55rem; background:var(--ink-tint-03); border:1px solid var(--hairline); border-radius:var(--radius-md); color:var(--espresso); cursor:pointer; }.release-grid img { width:64px; height:64px; object-fit:cover; }.release-grid small { display:block; color:var(--faded); }
  .open-album { margin:.8rem 0; padding:.55rem 1rem; border:0; border-radius:var(--radius-pill); background:var(--brick); color:var(--paper); cursor:pointer; }.credits { display:grid; gap:.3rem; }.credits button { display:grid; grid-template-columns:180px 1fr; text-align:left; padding:.55rem; background:none; border:0; border-top:1px solid var(--hairline); color:var(--espresso); cursor:pointer; }.credits span { color:var(--faded); font-size:.72rem; }
  footer { display:flex; justify-content:space-between; border-top:1px solid var(--hairline); margin-top:2rem; padding-top:1rem; color:var(--faded); font-size:.7rem; }.review { margin-top:1rem; color:var(--faded); }.review article { display:flex; justify-content:space-between; padding:.6rem 0; border-top:1px solid var(--hairline); }.review small { display:block; }.notice,.empty { padding:2rem 0; color:var(--faded); }.error { color:var(--brick); }
  .sync-actions button { background:none; border:0; padding:0 .2rem; color:var(--brick); cursor:pointer; }
  @media(max-width:700px){.search-row{grid-template-columns:1fr}.page{padding-inline:1rem}footer{display:grid;gap:.25rem}}
</style>
