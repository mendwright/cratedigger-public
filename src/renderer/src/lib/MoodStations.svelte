<script lang="ts">
  import { onMount } from 'svelte'
  import { plexState } from './plex-state.svelte'

  // A small curated set of moods we'd like to show first if Plex has them.
  // Anything not in this list still shows up sorted alphabetically below the
  // priority moods, so libraries with niche tagging don't get hidden.
  const PREFERRED = [
    'Reflective', 'Energetic', 'Mellow', 'Aggressive', 'Sad', 'Sentimental',
    'Sweet', 'Lively', 'Dramatic', 'Romantic', 'Sleepy', 'Dreamy',
    'Driving', 'Cool', 'Intense', 'Relaxed', 'Cheerful', 'Brooding'
  ]
  const MAX = 18

  let moods = $state<{ key: string; title: string }[]>([])
  let loading = $state(false)

  const COLLAPSE_KEY = 'cratedigger:rail-collapsed:moods'
  let collapsed = $state(
    typeof window !== 'undefined' && localStorage.getItem(COLLAPSE_KEY) === '1'
  )
  function toggleCollapsed(): void {
    collapsed = !collapsed
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      // localStorage unavailable; state stays in memory.
    }
  }

  async function load(): Promise<void> {
    if (!plexState.session?.signedIn || !plexState.session.preferredServerId) return
    if (!plexState.activeSectionKey) return
    loading = true
    try {
      const all = await window.cratedigger.plex.listMoods({
        serverId: plexState.session.preferredServerId,
        sectionKey: plexState.activeSectionKey
      })
      const order = new Map<string, number>()
      PREFERRED.forEach((m, i) => order.set(m.toLowerCase(), i))
      const ranked = [...all].sort((a, b) => {
        const ai = order.get(a.title.toLowerCase()) ?? 999
        const bi = order.get(b.title.toLowerCase()) ?? 999
        if (ai !== bi) return ai - bi
        return a.title.localeCompare(b.title)
      })
      moods = ranked.slice(0, MAX)
    } catch {
      moods = []
    } finally {
      loading = false
    }
  }

  onMount(() => {
    void load()
  })

  $effect(() => {
    plexState.activeSectionKey
    void load()
  })

  // The Plex mood key looks like "/library/sections/3/all?type=10&mood=12345"
  // — extract just the numeric mood ID for the album filter, falling back to
  // the raw key if we can't parse it.
  function moodId(key: string): string {
    const m = key.match(/[?&]mood=([^&]+)/)
    return m ? decodeURIComponent(m[1]) : key
  }

  const activeMoodId = $derived(plexState.filterState.selectedMood?.id ?? null)
</script>

{#if moods.length > 0}
  <section class="rail" class:rail-collapsed={collapsed}>
    <button class="heading" type="button" onclick={toggleCollapsed} aria-expanded={!collapsed}>
      <span class="chev">{collapsed ? '▸' : '▾'}</span>
      <span>moods</span>
      {#if collapsed}<span class="count">{moods.length}</span>{/if}
    </button>
    {#if !collapsed}
      <ul class="row">
        {#each moods as m (m.key)}
          {@const id = moodId(m.key)}
          <li>
            <button
              class="mood"
              class:mood-active={activeMoodId === id}
              onclick={() => plexState.setMood({ id, title: m.title })}
              title={activeMoodId === id ? `Clear ${m.title} filter` : `Filter library to ${m.title}`}
            >{m.title}</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{:else if loading}
  <section class="rail loading"><div class="heading-static">moods</div></section>
{/if}

<style>
  .rail {
    margin: 0 0 1.6rem;
  }
  .heading {
    text-transform: lowercase;
    color: var(--faded);
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    margin: 0 0 0.6rem;
    background: transparent;
    border: 0;
    padding: 0.1rem 0.25rem 0.1rem 0;
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    border-radius: var(--radius-sm);
  }
  .heading:hover { color: var(--espresso); background: var(--hairline); }
  .heading-static {
    text-transform: lowercase;
    color: var(--faded);
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    margin: 0 0 0.6rem;
  }
  .chev {
    display: inline-block;
    width: 0.8rem;
    text-align: center;
    font-size: 0.65rem;
    opacity: 0.7;
  }
  .count {
    font-size: 0.7rem;
    color: var(--ink-tint-12);
    margin-left: 0.15rem;
  }
  .row {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .mood {
    background: var(--ink-tint-04);
    border: 1px solid var(--ink-tint-08);
    color: var(--walnut);
    padding: 0.45rem 0.95rem;
    border-radius: var(--radius-pill);
    font-size: 0.85rem;
    cursor: pointer;
    transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
  }
  .mood:hover {
    color: var(--surface);
    background: var(--brick);
    border-color: var(--brick);
  }
  .mood-active {
    color: var(--surface);
    background: var(--espresso);
    border-color: var(--espresso);
  }
  .mood-active:hover {
    background: var(--walnut);
    border-color: var(--walnut);
  }
  .loading { min-height: 1.5rem; }
</style>
