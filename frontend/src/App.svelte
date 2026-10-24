<script lang="ts">
  import Nav from './lib/components/Nav.svelte';
  import { initRouter, router } from './lib/router.svelte';
  import { notFoundRoute, routes } from './lib/routes';

  initRouter(routes, notFoundRoute);

  const Page = $derived(router.route?.page);
</script>

<Nav />
<main class="container" class:container-wide={router.route?.wide}>
  <!-- Keyed so every navigation (including between projects) mounts a fresh page. -->
  {#key router.path}
    <div class="page-frame">
      <Page />
    </div>
  {/key}
</main>

<style>
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

  .page-frame {
    animation: fadeIn 0.5s ease-in;
  }

  @keyframes fadeIn {
    from {
      opacity: 0.5;
    }

    to {
      opacity: 1;
    }
  }
</style>
