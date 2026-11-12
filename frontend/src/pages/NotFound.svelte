<script lang="ts">
  import { router } from '../lib/router.svelte';
  import { pathFor, staticRoutePaths } from '../lib/routeDefinitions';
  import { suggestPath } from '../lib/routeMatching';

  const suggestedRoute = $derived(suggestPath(router.path, staticRoutePaths()));
</script>

<section class="not-found terminal-box">
  <h1 class="prompt">404</h1>
  <p>The page you requested does not exist.</p>
  {#if suggestedRoute}
    <p>Did you mean <a href={suggestedRoute}>{suggestedRoute}</a>?</p>
  {/if}
  <a class="button" href={pathFor('home')}>Go Home</a>
</section>

<style>
  .not-found {
    margin-top: 2rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: center;
  }

  h1 {
    margin: 0;
    font-size: 2.25rem;
  }
</style>
