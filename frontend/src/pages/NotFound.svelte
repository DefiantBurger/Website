<script lang="ts">
  import { closest } from 'fastest-levenshtein';
  import { navigate } from '../lib/router';
  import { currentRoute } from '../lib/router';

  const suggestions = ['/', '/projects', '/about', '/about-you', '/contact', '/utilities', '/utilities/scheduler', '/utilities/fileshare'];

  $: suggestedRoute = closest($currentRoute, suggestions);

  function goHome() {
    navigate('/');
  }
</script>

<svelte:head>
  <title>404 - Not Found</title>
  <meta name="description" content="The page you requested could not be found." />
</svelte:head>

<section class="not-found terminal-box">
  <h1>> 404</h1>
  <p>The page you requested does not exist.</p>
  {#if suggestedRoute}
    <p class="suggestion">
      Did you mean <a href={suggestedRoute} on:click|preventDefault={() => navigate(suggestedRoute)}>{suggestedRoute}</a>?
    </p>
  {/if}
  <div class="actions">
    <button type="button" on:click={goHome}>Go Home</button>
  </div>
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

  .not-found h1 {
    margin: 0;
    font-size: 2.25rem;
  }

  .not-found p {
    margin: 0;
  }

  .suggestion {
    font-size: 1rem;
  }

  .suggestion a {
    display: inline;
  }

  .actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    justify-content: center;
  }
</style>
