<script lang="ts">
  import { pathFor, routeDefinitions, SITE_NAME } from '../routeDefinitions';
  import { router } from '../router.svelte';
  import { shell } from '../shell/shell.svelte';
  import { theme } from '../theme.svelte';

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
  // The mobile menu is absolutely positioned, so opening it doesn't change this.
  let navHeight = $state(0);
  $effect(() => {
    document.documentElement.style.scrollPaddingTop = `${navHeight}px`;
  });

  let menuOpen = $state(false);
  let menuButton: HTMLButtonElement;
  let menu: HTMLElement;

  // Covers navigation the menu didn't start: Back/Forward and the shell's `cd`.
  $effect(() => {
    void router.path;
    menuOpen = false;
  });

  function closeMenuOnLink(event: MouseEvent) {
    // Same-page links don't change the path, so the effect above wouldn't fire.
    if (event.target instanceof Element && event.target.closest('a')) {
      menuOpen = false;
    }
  }

  function closeMenuOnOutsideClick(event: MouseEvent) {
    const target = event.target as Node;
    if (menuOpen && !menu.contains(target) && !menuButton.contains(target)) {
      menuOpen = false;
    }
  }

  function closeMenuOnEscape(event: KeyboardEvent) {
    if (menuOpen && event.key === 'Escape') {
      menuOpen = false;
      menuButton.focus();
    }
  }
</script>

<svelte:window onclick={closeMenuOnOutsideClick} onkeydown={closeMenuOnEscape} />

<!-- Rendered once in the desktop bar and once in the mobile menu; CSS hides the copy that doesn't apply. -->
{#snippet navLinks()}
  <ul class="nav-links">
    {#each links as link (link.path)}
      <li>
        <a href={link.path} class:active={isActive(link.path)} aria-current={ariaCurrent(link.path)}
          >{link.label}</a
        >
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet themeButton()}
  <button type="button" class="nav-button" onclick={() => theme.toggle()}>
    {theme.current === 'dark' ? 'Light Mode' : 'Dark Mode'}
  </button>
{/snippet}

<nav class="nav" aria-label="Main" bind:offsetHeight={navHeight}>
  <div class="nav-container">
    <div class="nav-brand">
      <a href={pathFor('home')} class="prompt">{SITE_NAME}</a>
    </div>
    <div class="desktop-only nav-links-bar">{@render navLinks()}</div>

    <div class="nav-actions">
      <button
        type="button"
        class="nav-button"
        aria-label="Shell"
        aria-expanded={shell.isOpen}
        onclick={() => shell.toggle()}>&gt;_</button
      >
      <div class="desktop-only">{@render themeButton()}</div>
      <button
        type="button"
        class="nav-button menu-button mobile-only"
        aria-expanded={menuOpen}
        aria-controls="nav-menu"
        bind:this={menuButton}
        onclick={() => (menuOpen = !menuOpen)}>menu</button
      >
    </div>
  </div>

  <!-- After the menu button in the DOM, so Tab moves from the button into the open menu. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    id="nav-menu"
    class="nav-menu mobile-only"
    hidden={!menuOpen}
    bind:this={menu}
    onclick={closeMenuOnLink}
  >
    {@render navLinks()}
    {@render themeButton()}
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

  .nav-links-bar {
    margin-right: auto;
    margin-left: 1.5rem;
  }

  .nav-links {
    display: flex;
    list-style: none;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .nav-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-shrink: 0;
  }

  .nav-button {
    font-size: 0.8rem;
    padding: 0.4rem 0.7rem;
    white-space: nowrap;
    border-width: 1px;
  }

  /* Brackets drawn in CSS so screen readers announce just "menu" (same trick as .prompt). */
  .menu-button::before {
    content: '[';
    content: '[' / '';
  }

  .menu-button::after {
    content: ']';
    content: ']' / '';
  }

  .menu-button[aria-expanded='true'] {
    background-color: var(--color-primary-opacity-20);
    color: var(--color-text-hover);
  }

  .nav-links a {
    border-bottom: 2px solid transparent;
    padding-bottom: 0.25rem;
  }

  .nav-links a:hover,
  .nav-links a.active {
    border-bottom: 2px solid var(--color-text-primary);
  }

  .mobile-only {
    display: none;
  }

  @media (max-width: 768px) {
    .desktop-only {
      display: none;
    }

    .mobile-only {
      display: revert;
    }

    .nav-container {
      padding: 0 1rem;
      gap: 0.75rem;
    }

    .nav-brand a {
      font-size: 1rem;
    }

    .nav-actions {
      gap: 0.5rem;
    }

    /* Drawn over the page, so opening it doesn't push content down or change the nav's height. */
    .nav-menu {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      /* Covers the nav's bottom border so the two read as one panel. */
      margin-top: -2px;
      padding: 0.5rem 1rem 1rem;
      background-color: var(--color-bg-dark);
      border-bottom: 2px solid var(--color-text-primary);
      box-shadow: 0 6px 12px var(--color-primary-opacity-10);
    }

    /* .mobile-only's display would otherwise beat the hidden attribute. */
    .nav-menu[hidden] {
      display: none;
    }

    .nav-menu .nav-links {
      flex-direction: column;
      gap: 0;
      margin-bottom: 0.75rem;
    }

    /* Full-width rows make comfortable tap targets. */
    .nav-menu .nav-links a {
      display: block;
      padding: 0.6rem 0;
    }

    .nav-menu .nav-links a.active,
    .nav-menu .nav-links a:hover {
      border-bottom-color: transparent;
      color: var(--color-text-hover);
    }

    .nav-menu .nav-links a.active::before {
      content: '> ';
      content: '> ' / '';
    }
  }

  /* Keeps the one-row bar from overflowing on 360px phones. */
  @media (max-width: 400px) {
    .nav-brand a {
      font-size: 0.875rem;
    }

    .nav-button {
      padding: 0.4rem 0.5rem;
    }
  }
</style>
