<script lang="ts">
  import { onMount } from 'svelte';
  import { currentRoute, navigate } from '../router';

  const links = [
    { label: 'Home', path: '/' },
    { label: 'Projects', path: '/projects' },
    { label: 'Utilities', path: '/utilities' },
    { label: 'About', path: '/about' },
    { label: 'Contact', path: '/contact' }
  ];

  function handleClick(path: string) {
    navigate(path);
  }

  function isActive(path: string): boolean {
    if (path === '/utilities') {
      return $currentRoute.startsWith('/utilities');
    }
    return $currentRoute === path;
  }

  type Theme = 'dark' | 'light';
  let theme: Theme = 'dark';

  function applyTheme(nextTheme: Theme): void {
    theme = nextTheme;
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
  }

  function toggleTheme(): void {
    applyTheme(theme === 'dark' ? 'light' : 'dark');
  }

  onMount(() => {
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme === 'light' || storedTheme === 'dark') {
      applyTheme(storedTheme);
      return;
    }

    applyTheme('dark');
  });
</script>

<nav class="nav">
  <div class="nav-container">
    <div class="nav-brand">
      <a href="/" on:click={(e) => { e.preventDefault(); handleClick('/'); }}>
        > JosephCicalese.com
      </a>
    </div>
    <ul class="nav-links">
      {#each links as link}
        <li>
          <a 
            href={link.path}
            on:click={(e) => { e.preventDefault(); handleClick(link.path); }}
            class:active={isActive(link.path)}
          >
            {link.label}
          </a>
        </li>
      {/each}
    </ul>

    <button
      type="button"
      class="theme-toggle"
      on:click={toggleTheme}
      aria-label="Toggle light and dark theme"
    >
      {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
    </button>
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
    max-width: none;
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
    color: var(--color-text-primary);
    text-shadow: none;
    border: none;
  }

  .nav-brand a:hover {
    color: var(--color-text-hover);
    text-shadow: none;
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

  .theme-toggle {
    font-size: 0.8rem;
    padding: 0.4rem 0.7rem;
    white-space: nowrap;
    border-width: 1px;
  }

  .nav-links a {
    color: var(--color-text-primary);
    text-decoration: none;
    border-bottom: 2px solid transparent;
    transition: all 0.2s ease;
    padding-bottom: 0.25rem;
  }

  .nav-links a:hover {
    border-bottom: 2px solid var(--color-text-primary);
    color: var(--color-text-hover);
    text-shadow: none;
  }

  .nav-links a.active {
    border-bottom: 2px solid var(--color-text-primary);
    text-shadow: none;
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
