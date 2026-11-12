<script lang="ts">
  import { tick } from 'svelte';

  import Nav from './lib/components/Nav.svelte';
  import PageMeta from './lib/components/PageMeta.svelte';
  import { initRouter, router } from './lib/router.svelte';
  import { notFoundRoute, routes } from './lib/routes';
  import { SITE_ORIGIN } from './lib/site';

  initRouter(routes, notFoundRoute);

  const Page = $derived(router.route?.page);

  let mainElement: HTMLElement;
  let announcement = $state('');
  let isFirstRoute = true;

  // A client-side navigation doesn't reload the page, so screen readers would
  // stay on the clicked link and hear nothing. Move focus to the new content
  // and announce its title, as a full page load would.
  $effect(() => {
    void router.path;
    if (isFirstRoute) {
      isFirstRoute = false;
      return;
    }
    // Wait for <svelte:head> to update the title.
    void tick().then(() => {
      mainElement.focus({ preventScroll: true });
      announcement = document.title;
    });
  });
</script>

<svelte:head>
  {#if router.route && router.route !== notFoundRoute}
    <link rel="canonical" href="{SITE_ORIGIN}{router.path}" />
  {/if}
</svelte:head>

<!-- Routes without meta (e.g. project pages) render their own PageMeta. -->
{#if router.route?.meta}
  <PageMeta {...router.route.meta} />
{/if}

<a class="skip-link" href="#main">Skip to content</a>
<Nav />
<main
  id="main"
  tabindex="-1"
  bind:this={mainElement}
  class="container"
  class:container-wide={router.route?.layout?.wide}
>
  <!-- Keyed so every navigation (including between projects) mounts a fresh page. -->
  {#key router.path}
    <div class="page-frame">
      <Page />
    </div>
  {/key}
</main>
<div class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>

<style>
  main {
    flex: 1;
  }

  /* Focus lands here on navigation and via the skip link; it isn't a control. */
  main:focus {
    outline: none;
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

  @media (max-width: 768px) {
    .container {
      padding: 1.5rem 1rem;
    }
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
