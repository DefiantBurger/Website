<script lang="ts">
  import { onMount } from 'svelte';
  import './app.css';
  import Nav from './lib/components/Nav.svelte';
  import { currentPage, currentRoute, initRouter } from './lib/router';

  onMount(() => {
    initRouter();
  });
</script>

<div id="app">
  <Nav />
  <main class="container" class:container-wide={$currentRoute.startsWith('/utilities/scheduler')}>
    {#if $currentPage}
      <svelte:component this={$currentPage} />
    {:else}
      <div class="loading">
        > Loading...
      </div>
    {/if}
  </main>
</div>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
  }

  #app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  main {
    flex: 1;
  }

  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
    width: 100%;
  }

  .container-wide {
    max-width: min(1800px, 98vw);
    padding-left: 1.2rem;
    padding-right: 1.2rem;
  }

  .loading {
    color: var(--color-text-primary);
    text-align: center;
    font-size: 1.5rem;
    margin-top: 3rem;
  }
</style>
