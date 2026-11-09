<script lang="ts">
  import { router } from '../lib/router.svelte';
  import { theme } from '../lib/theme.svelte';
  import { loadProject } from '../lib/projects/content';
  import { recordProjectView } from '../lib/aboutYou/interactionStore';
  import StatusMessage from '../lib/components/StatusMessage.svelte';
  import TagList from '../lib/components/TagList.svelte';
  import { errorMessage } from '../lib/api';

  // App remounts this page on every path change, so the slug is fixed per instance.
  const slug = router.params.slug;
  const debugEnabled = new URLSearchParams(window.location.search).get('debugMermaid') === '1';

  let mermaidRun = $state<{
    domMermaidNodes: number;
    domMermaidCodeNodes: number;
    firstMermaidSource: string;
    status: 'not-run' | 'success' | 'error';
    error: string;
  }>({
    domMermaidNodes: 0,
    domMermaidCodeNodes: 0,
    firstMermaidSource: '',
    status: 'not-run',
    error: '',
  });

  async function loadPage() {
    const project = await loadProject(slug);
    recordProjectView(slug);
    return project;
  }

  const pagePromise = loadPage();

  /** Attachment: render Mermaid diagrams, and re-render them when the site theme changes. */
  function renderMermaid(article: HTMLElement) {
    // Read the theme here, not after an await, so the attachment keeps tracking it.
    void runMermaid(article, theme.current === 'dark' ? 'dark' : 'default');
  }

  async function runMermaid(article: HTMLElement, mermaidTheme: 'dark' | 'default') {
    const nodes = Array.from(article.querySelectorAll<HTMLElement>('.mermaid'));
    const codeNodes = Array.from(
      article.querySelectorAll<HTMLElement>('pre > code.language-mermaid'),
    );

    mermaidRun.domMermaidNodes = nodes.length;
    mermaidRun.domMermaidCodeNodes = codeNodes.length;
    mermaidRun.firstMermaidSource =
      (nodes[0] ?? codeNodes[0])?.textContent?.trim().slice(0, 220) ?? '';

    if (nodes.length > 0) {
      try {
        // Loaded on demand: a static import would put Mermaid (most of the site's
        // JS) in every page's preload list, since routes.ts imports all pages eagerly.
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: mermaidTheme });

        // Restore each diagram's source so a theme change can re-render it.
        for (const node of nodes) {
          node.dataset.mermaidSource ??= node.textContent?.trim() ?? '';
          node.removeAttribute('data-processed');
          node.textContent = node.dataset.mermaidSource;
        }

        await mermaid.run({ nodes });
        mermaidRun.status = 'success';
      } catch (mermaidError) {
        mermaidRun.status = 'error';
        mermaidRun.error = errorMessage(mermaidError, String(mermaidError));
        console.error('Mermaid rendering failed', mermaidError);
      }
    }

    if (debugEnabled) {
      console.log('Mermaid Debug', $state.snapshot(mermaidRun));
    }
  }

  const yesNo = (value: boolean) => (value ? 'yes' : 'no');
</script>

<svelte:head>
  {#await pagePromise}
    <title>Project Details · JosephCicalese.com</title>
    <meta name="description" content="Explore this project in detail." />
  {:then project}
    <title>{project.title} · JosephCicalese.com</title>
    <meta name="description" content={project.summary || 'Explore this project in detail.'} />
  {/await}
</svelte:head>

<a class="button back-button" href="/projects">&lt; Back to Projects</a>

{#await pagePromise}
  <StatusMessage kind="loading" message="Loading project..." />
{:then project}
  {@const renderDebug = project.debug}
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

  {#if debugEnabled}
    {@const debugRows = [
      ['Slug', slug],
      ['Markdown length', renderDebug.markdownLength],
      ['Input has mermaid fence', yesNo(renderDebug.inputHasMermaidFence)],
      ['Transformed mermaid blocks', renderDebug.transformedMermaidBlocks],
      ['Output has .mermaid div', yesNo(renderDebug.outputHasMermaidDiv)],
      ['Output still has language-mermaid code', yesNo(renderDebug.outputHasMermaidCodeFence)],
      ['Rendered HTML length', renderDebug.htmlLength],
      ['DOM .mermaid nodes', mermaidRun.domMermaidNodes],
      ['DOM mermaid code nodes', mermaidRun.domMermaidCodeNodes],
      ['Mermaid run status', mermaidRun.status],
    ]}
    <section class="debug-panel terminal-box">
      <h2 class="prompt">Mermaid Debug Panel</h2>
      {#each debugRows as [label, value] (label)}
        <p><strong>{label}:</strong> {value}</p>
      {/each}

      {#if mermaidRun.error}
        <pre class="debug-error">{mermaidRun.error}</pre>
      {/if}

      {#if mermaidRun.firstMermaidSource}
        <p><strong>First Mermaid source preview:</strong></p>
        <pre>{mermaidRun.firstMermaidSource}</pre>
      {/if}

      <p class="debug-hint">
        Append <code>?debugMermaid=1</code> to this page URL to show this panel.
      </p>
    </section>
  {/if}
{:catch error}
  <StatusMessage kind="error" message={errorMessage(error, 'Failed to load project details.')} />
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

  .project-content :global(.heading-anchor) {
    margin-left: 1rem;
    opacity: 0.5;
  }

  .project-content :global(.heading-anchor:hover) {
    opacity: 1;
  }

  .debug-panel {
    margin-top: 1rem;
    border-style: dashed;
  }

  .debug-panel h2 {
    font-size: 1.1rem;
    margin-bottom: 0.8rem;
  }

  .debug-panel p {
    margin-bottom: 0.45rem;
  }

  .debug-panel pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border: 1px solid var(--color-text-primary);
    border-radius: 3px;
    padding: 0.7rem;
    background: var(--color-primary-opacity-10);
    margin-bottom: 0.6rem;
  }

  .debug-error {
    color: var(--color-error);
    border-color: var(--color-error);
    background: var(--color-error-opacity-05);
  }

  .debug-hint {
    color: var(--color-text-muted);
  }
</style>
