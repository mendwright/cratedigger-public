<script lang="ts">
  import { plexState } from '../lib/plex-state.svelte'
  import ScreenHeader from '../lib/ScreenHeader.svelte'
  import NewsList from '../lib/NewsList.svelte'
</script>

<div class="page">
  <ScreenHeader
    --screen-header-bleed="2rem"
    --screen-header-gap="1.1rem"
    --screen-header-max="900px"
    onback={() => plexState.goHome()}
    kicker="your artists"
    title="News"
    sub="Pitchfork, Stereogum, BrooklynVegan, The Quietus and Aquarium Drunkard, fetched every two hours"
  />
  <NewsList />
</div>

<style>
  .page {
    height: 100%;
    overflow-y: auto;
    padding: 0 2rem 4rem;
    box-sizing: border-box;
  }
  .page > :global(*) {
    max-width: 900px;
    margin-left: auto;
    margin-right: auto;
  }
</style>
