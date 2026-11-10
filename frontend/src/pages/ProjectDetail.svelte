<script lang="ts">
  import { router } from '../lib/router.svelte';
  import { theme } from '../lib/theme.svelte';
  import { loadProject } from '../lib/projects/content';
  import { recordProjectView } from '../lib/aboutYou/interactionStore';
  import StatusMessage from '../lib/components/StatusMessage.svelte';
  import TagList from '../lib/components/TagList.svelte';

  // App remounts this page on every path change, so the slug is fixed per instance.
  const slug = router.params.slug;

  async function loadPage() {
    const project = await loadProject(slug);
    recordProjectView(slug);
    return project;
  }

  const pagePromise = loadPage();

  // Runs are chained so two never touch the same nodes at once; a run queued
  // behind a newer theme toggle is skipped.
  let mermaidQueue = Promise.resolve();
  let latestRun = 0;

  /** Attachment: render Mermaid diagrams, and re-render them when the site theme changes. */
  function renderMermaid(article: HTMLElement) {
    // Read the theme here, not after an await, so the attachment keeps tracking it.
    const mermaidTheme = theme.current === 'dark' ? 'dark' : 'default';
    const run = ++latestRun;
    mermaidQueue = mermaidQueue.then(() =>
      run === latestRun ? runMermaid(article, mermaidTheme) : undefined,
    );
  }

  async function runMermaid(article: HTMLElement, mermaidTheme: 'dark' | 'default') {
    const nodes = Array.from(article.querySelectorAll<HTMLElement>('.mermaid'));
    if (nodes.length === 0) {
      return;
    }

    try {
      // Loaded on demand: a static import would put Mermaid (most of the site's
      // JS) in every page's preload list, since routes.ts imports all pages eagerly.
      const { default: mermaid } = await import('mermaid');
      const surface = getComputedStyle(article).getPropertyValue('--color-bg-surface').trim();
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: mermaidTheme,
        // The dark theme's gray edge-label box fails contrast; use the diagram background.
        themeVariables: { edgeLabelBackground: surface },
      });

      // Restore each diagram's source so a theme change can re-render it.
      for (const node of nodes) {
        node.dataset.mermaidSource ??= node.textContent?.trim() ?? '';
        node.removeAttribute('data-processed');
        node.textContent = node.dataset.mermaidSource;
      }

      await mermaid.run({ nodes });
      keepDiagramsReadable(nodes);
    } catch (mermaidError) {
      console.error('Mermaid rendering failed', mermaidError);
    }
  }

  /** Stop wide diagrams from shrinking past legibility; the `.mermaid` box scrolls instead. */
  function keepDiagramsReadable(nodes: HTMLElement[]) {
    for (const [index, node] of nodes.entries()) {
      // Focusable so keyboard users can scroll the box with the arrow keys.
      node.tabIndex = 0;
      node.setAttribute('role', 'region');
      node.setAttribute('aria-label', `Diagram ${index + 1}`);
      const svg = node.querySelector('svg');
      // Mermaid caps each SVG at its natural width via an inline max-width. At 60%,
      // its 16px labels stay near 10px and the current diagrams still fit on desktop.
      const naturalWidth = parseFloat(svg?.style.maxWidth ?? '');
      if (svg && naturalWidth > 0) {
        svg.style.minWidth = `${Math.round(naturalWidth * 0.6)}px`;
      }
    }
  }
</script>

<svelte:head>
  {#await pagePromise}
    <title>Project Details · JosephCicalese.com</title>
    <meta name="description" content="Explore this project in detail." />
  {:then project}
    <title>{project.title} · JosephCicalese.com</title>
    <meta name="description" content={project.summary || 'Explore this project in detail.'} />
  {:catch}
    <title>Project Failed to Load · JosephCicalese.com</title>
    <meta name="description" content="Explore this project in detail." />
  {/await}
</svelte:head>

<a class="button back-button" href="/projects">&lt; Back to Projects</a>

{#await pagePromise}
  <StatusMessage kind="loading" message="Loading project..." />
{:then project}
  <header class="terminal-box">
    <h1 class="prompt">{project.title}</h1>
    <TagList tags={project.tags} />

    <div class="project-links">
      {#if project.repo}
        <a href={project.repo} target="_blank" rel="noreferrer">Repository</a>
      {/if}
      {#if project.demo}
        <a href={project.demo} target="_blank" rel="noreferrer">Live Site</a>
      {/if}
    </div>
  </header>

  <article class="project-content terminal-box" {@attach renderMermaid}>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- build-time Markdown, sanitized by rehype-sanitize -->
    {@html project.html}
  </article>
{:catch}
  <!-- Unknown slugs 404 in the router, so this is a failed chunk load; its error text is a dev URL. -->
  <StatusMessage kind="error" message="Couldn't load this project. Try refreshing the page." />
{/await}

<style>
  .back-button {
    margin-bottom: 1rem;
  }

  .project-links {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .project-content :global(h1),
  .project-content :global(h2),
  .project-content :global(h3) {
    margin-top: 1.4rem;
  }

  .project-content :global(pre) {
    overflow-x: auto;
    border: 1px solid var(--color-text-primary);
    border-radius: 3px;
    padding: 0.9rem;
    background: var(--color-primary-opacity-10);
    margin-bottom: 1rem;
  }

  .project-content :global(code) {
    white-space: pre-wrap;
  }

  /* Undo the global inline `code` box so fenced blocks don't nest a border inside the `pre`. */
  .project-content :global(pre code) {
    display: block;
    border: 0;
    padding: 0;
  }

  .project-content :global(ul),
  .project-content :global(ol) {
    margin-left: 1.2rem;
    margin-bottom: 1rem;
  }

  .project-content :global(ul > li) {
    margin-left: 0.5rem;
  }

  .project-content :global(ol > li) {
    margin-left: 1.5rem;
  }

  .project-content :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin-bottom: 1rem;
  }

  .project-content :global(th),
  .project-content :global(td) {
    border: 1px solid var(--color-text-primary);
    padding: 0.45rem 0.55rem;
    text-align: left;
  }

  .project-content :global(.mermaid) {
    overflow-x: auto;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-text-primary);
    border-radius: 3px;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .project-content :global(.mermaid svg) {
    display: block;
    margin-inline: auto;
  }

  .project-content :global(.heading-anchor) {
    margin-left: 1rem;
    opacity: 0.5;
  }

  .project-content :global(.heading-anchor:hover) {
    opacity: 1;
  }
</style>
