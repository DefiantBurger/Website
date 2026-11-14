<script lang="ts">
  import { mount, unmount } from 'svelte';
  import { router } from '../lib/router.svelte';
  import { theme } from '../lib/theme.svelte';
  import { loadProject } from '../lib/projects/content';
  import { recordProjectView } from '../lib/aboutYou/interactionStore';
  import StatusMessage from '../lib/components/StatusMessage.svelte';
  import ExternalLink from '../lib/components/ExternalLink.svelte';
  import TagList from '../lib/components/TagList.svelte';
  import PageMeta from '../lib/components/PageMeta.svelte';
  import { pathFor, PROJECT_FALLBACK_DESCRIPTION } from '../lib/routeDefinitions';
  import { isDemoId } from '../lib/demos/ids';
  import { DEMOS } from '../lib/demos/registry';

  // App remounts this page on every path change, so the slug is fixed per instance.
  const slug = router.params.slug;

  async function loadPage() {
    const project = await loadProject(slug);
    recordProjectView(slug);
    // Math is typeset at build time, but its CSS would double the global stylesheet,
    // so only pages with math load it. Awaited because unstyled KaTeX shows each equation twice.
    if (project.html.includes('class="katex')) {
      await import('katex/dist/katex.min.css');
    }
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

  /** Attachment: mount each interactive demo into its build-time placeholder (renderMarkdown.ts). */
  function mountDemos(article: HTMLElement) {
    const mounted: ReturnType<typeof mount>[] = [];
    let destroyed = false;
    for (const node of article.querySelectorAll<HTMLElement>('.project-demo')) {
      const id = node.dataset.demo ?? '';
      if (!isDemoId(id)) {
        continue;
      }
      DEMOS[id]()
        .then(({ default: Demo }) => {
          if (destroyed) {
            return;
          }
          node.textContent = '';
          mounted.push(mount(Demo, { target: node }));
        })
        .catch((demoError) => {
          console.error(`Demo ${id} failed to load`, demoError);
          node.textContent = "Couldn't load this demo. Try refreshing the page.";
        });
    }
    return () => {
      destroyed = true;
      for (const demo of mounted) {
        void unmount(demo);
      }
    };
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

<a class="button back-button" href={pathFor('projects')}>&lt; Back to Projects</a>

{#await pagePromise}
  <PageMeta title="Project Details" description={PROJECT_FALLBACK_DESCRIPTION} />
  <StatusMessage kind="loading" message="Loading project..." />
{:then project}
  <PageMeta title={project.title} description={project.summary || PROJECT_FALLBACK_DESCRIPTION} />
  <header class="terminal-box">
    <h1 class="prompt">{project.title}</h1>
    <TagList tags={project.tags} />

    <div class="project-links">
      {#if project.repo}
        <ExternalLink href={project.repo}>Repository</ExternalLink>
      {/if}
      {#if project.demo}
        <ExternalLink href={project.demo}>Live Site</ExternalLink>
      {/if}
    </div>
  </header>

  <article class="project-content terminal-box" {@attach renderMermaid} {@attach mountDemos}>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- build-time Markdown, sanitized by rehype-sanitize -->
    {@html project.html}
  </article>
{:catch}
  <PageMeta title="Project Failed to Load" description={PROJECT_FALLBACK_DESCRIPTION} />
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

  .project-content :global(h2) {
    border-bottom: 1px solid var(--color-text-primary);
    padding-bottom: 0.4rem;
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

  /* Long equations scroll on their own instead of widening the page. The scroll box
     clips vertically too, and tall glyphs (fractions, exponents) extend a few px past
     KaTeX's line box, so trade KaTeX's 1em margin for padding the glyphs can use. */
  .project-content :global(.katex-display) {
    overflow-x: auto;
    overflow-y: hidden;
    margin-block: 0;
    padding-block: 1em;
  }

  .project-content :global(blockquote) {
    border-left: 3px solid var(--color-text-primary);
    padding: 0.6rem 0.9rem;
    background: var(--color-primary-opacity-10);
    margin-bottom: 1rem;
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

  /* Build-time wrapper (renderMarkdown.ts): a wide table scrolls here instead of widening the page. */
  .project-content :global(.table-scroll) {
    overflow-x: auto;
    margin-bottom: 1rem;
  }

  .project-content :global(table) {
    border-collapse: collapse;
    width: 100%;
  }

  @media (max-width: 768px) {
    /* KaTeX's default 1.21em makes most display equations wider than a phone. */
    .project-content :global(.katex-display > .katex) {
      font-size: 1em;
    }
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

  /* Reserved so the page doesn't jump when the demo mounts. Kept below every demo's
     real height at that width, or a gap would stay underneath it. */
  .project-content :global(.project-demo) {
    min-height: 32rem;
  }

  @media (max-width: 520px) {
    /* Demos stack their panels below this width, so they are much taller. */
    .project-content :global(.project-demo) {
      min-height: 52rem;
    }
  }

  .project-content :global(.heading-anchor) {
    margin-left: 1rem;
    opacity: 0.5;
  }

  .project-content :global(.heading-anchor:hover) {
    opacity: 1;
  }
</style>
