<script lang="ts">
  import { router } from '../router.svelte';
  import { theme } from '../theme.svelte';

  const links = [
    { label: 'Home', path: '/' },
    { label: 'Projects', path: '/projects' },
    { label: 'Utilities', path: '/utilities' },
    { label: 'About', path: '/about' },
    { label: 'Contact', path: '/contact' }
  ];

  // A section link stays active on its subpages (e.g. Projects on /projects/foo).
  function isActive(path: string): boolean {
    return router.path === path || (path !== '/' && router.path.startsWith(`${path}/`));
  }
</script>

<nav class="nav">
  <div class="nav-container">
    <div class="nav-brand">
      <a href="/">> JosephCicalese.com</a>
    </div>
    <ul class="nav-links">
      {#each links as link (link.path)}
        <li>
          <a href={link.path} class:active={isActive(link.path)}>{link.label}</a>
        </li>
      {/each}
    </ul>

    <div class="nav-actions">
      <a
        class="status-link"
        href="https://status.josephcicalese.com/"
        target="_blank"
        rel="noopener noreferrer"
      >
        Status
      </a>
      <button
        type="button"
        class="theme-toggle"
        onclick={() => theme.toggle()}
        aria-label="Toggle light and dark theme"
      >
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

  .status-link {
    font-size: 0.8rem;
    border-bottom: 1px solid transparent;
  }

  .status-link:hover {
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
