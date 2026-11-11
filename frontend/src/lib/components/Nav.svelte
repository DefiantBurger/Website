<script lang="ts">
  import { pathFor, routeDefinitions, SITE_NAME } from '../routeDefinitions';
  import { router } from '../router.svelte';
  import { STATUS_PAGE_URL } from '../site';
  import { theme } from '../theme.svelte';
  import ExternalLink from './ExternalLink.svelte';

  // Home's tab title is just the site name, so its label is written out here.
  const links = [
    { label: 'Home', path: pathFor('home') },
    ...(['projects', 'utilities', 'about', 'contact'] as const).map((key) => ({
      label: routeDefinitions[key].meta.title,
      path: pathFor(key),
    })),
  ];

  // A section link stays active on its subpages (e.g. Projects on /projects/foo).
  function isActive(path: string): boolean {
    return router.path === path || (path !== '/' && router.path.startsWith(`${path}/`));
  }

  // 'page' for the exact page; 'true' marks the section a subpage belongs to.
  function ariaCurrent(path: string): 'page' | 'true' | undefined {
    if (router.path === path) {
      return 'page';
    }
    return isActive(path) ? 'true' : undefined;
  }

  // The nav is sticky, so anchor targets must stop below it; its height varies as links wrap.
  let navHeight = $state(0);
  $effect(() => {
    document.documentElement.style.scrollPaddingTop = `${navHeight}px`;
  });
</script>

<nav class="nav" aria-label="Main" bind:offsetHeight={navHeight}>
  <div class="nav-container">
    <div class="nav-brand">
      <a href={pathFor('home')} class="prompt">{SITE_NAME}</a>
    </div>
    <ul class="nav-links">
      {#each links as link (link.path)}
        <li>
          <a
            href={link.path}
            class:active={isActive(link.path)}
            aria-current={ariaCurrent(link.path)}>{link.label}</a
          >
        </li>
      {/each}
    </ul>

    <div class="nav-actions">
      <ExternalLink class="status-link" href={STATUS_PAGE_URL}>Status</ExternalLink>
      <button type="button" class="theme-toggle" onclick={() => theme.toggle()}>
        {theme.current === 'dark' ? 'Light Mode' : 'Dark Mode'}
      </button>
    </div>
  </div>
</nav>

<style>
  .nav {
    background-color: var(--color-bg-dark);
    border-bottom: 2px solid var(--color-text-primary);
    padding: 1rem 0;
    position: sticky;
    top: 0;
    z-index: 100;
    box-shadow: 0 6px 12px var(--color-primary-opacity-10);
  }

  .nav-container {
    padding: 0 2rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 2rem;
  }

  .nav-brand {
    flex-shrink: 0;
  }

  .nav-brand a {
    font-size: 1.25rem;
    font-weight: bold;
    border: none;
  }

  .nav-brand a:hover {
    color: var(--color-text-hover);
    border: none;
  }

  .nav-links {
    display: flex;
    list-style: none;
    gap: 1.5rem;
    flex-wrap: wrap;
    margin-right: auto;
    margin-left: 1.5rem;
  }

  .nav-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-shrink: 0;
  }

  .nav-actions :global(.status-link) {
    font-size: 0.8rem;
    border-bottom: 1px solid transparent;
  }

  .nav-actions :global(.status-link:hover) {
    border-bottom: 1px solid var(--color-text-primary);
  }

  .theme-toggle {
    font-size: 0.8rem;
    padding: 0.4rem 0.7rem;
    white-space: nowrap;
    border-width: 1px;
  }

  .nav-links a {
    border-bottom: 2px solid transparent;
    padding-bottom: 0.25rem;
  }

  .nav-links a:hover,
  .nav-links a.active {
    border-bottom: 2px solid var(--color-text-primary);
  }

  @media (max-width: 768px) {
    .nav-container {
      flex-direction: column;
      gap: 1rem;
    }

    .nav-links {
      margin: 0;
      justify-content: center;
      gap: 1rem;
    }
  }
</style>
