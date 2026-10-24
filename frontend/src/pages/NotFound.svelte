<script lang="ts">
  import { closest } from 'fastest-levenshtein';
  import { navigate, router, staticPaths } from '../lib/router.svelte';

  const suggestedRoute = $derived(closest(router.path, staticPaths()));
</script>

<svelte:head>
  <title>404 - Not Found</title>
  <meta name="description" content="The page you requested could not be found." />
</svelte:head>

<section class="not-found terminal-box">
  <h1>> 404</h1>
  <p>The page you requested does not exist.</p>
  {#if suggestedRoute}
    <p>Did you mean <a href={suggestedRoute}>{suggestedRoute}</a>?</p>
  {/if}
  <button type="button" onclick={() => navigate('/')}>Go Home</button>
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
