<script lang="ts">
  import mermaid from 'mermaid';

  import { navigate, router } from '../lib/router.svelte';
  import { theme } from '../lib/theme.svelte';
  import { loadProjectBySlug } from '../lib/projects/api';
  import { renderProjectMarkdownWithDebug } from '../lib/projects/renderMarkdown';
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
  }>({ domMermaidNodes: 0, domMermaidCodeNodes: 0, firstMermaidSource: '', status: 'not-run', error: '' });

  async function loadPage() {
    const project = await loadProjectBySlug(slug);
    recordProjectView(slug);
    const rendered = await renderProjectMarkdownWithDebug(project.markdown);
    return { project, html: rendered.html, renderDebug: rendered.debug };
  }

  const pagePromise = loadPage();

  /** Attachment: render Mermaid diagrams, and re-render them when the site theme changes. */
  function renderMermaid(article: HTMLElement) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme.current === 'dark' ? 'dark' : 'default'
    });
    void runMermaid(article);
  }

  async function runMermaid(article: HTMLElement) {
    const nodes = Array.from(article.querySelectorAll<HTMLElement>('.mermaid'));
    const codeNodes = Array.from(article.querySelectorAll<HTMLElement>('pre > code.language-mermaid'));

    mermaidRun.domMermaidNodes = nodes.length;
    mermaidRun.domMermaidCodeNodes = codeNodes.length;
    mermaidRun.firstMermaidSource = (nodes[0] ?? codeNodes[0])?.textContent?.trim().slice(0, 220) ?? '';

    if (nodes.length > 0) {
      try {
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
    <title>Project Details</title>
    <meta name="description" content="Explore this project in detail." />
  {:then { project }}
    <title>{project.title}</title>
    <meta name="description" content={project.summary || 'Explore this project in detail.'} />
  {/await}
</svelte:head>

<button class="back-button" onclick={() => navigate('/projects')}>&lt; Back to Projects</button>

{#await pagePromise}
  <StatusMessage kind="loading" message="Loading project..." />
{:then { project, html, renderDebug }}
  <header class="terminal-box">
    <h1>> {project.title}</h1>
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
    {@html html}
  </article>

  {#if debugEnabled}
    {@const debugRows = [
      ['Slug', slug],
      ['Markdown length', project.markdown.length],
      ['Input has mermaid fence', yesNo(renderDebug.inputHasMermaidFence)],
      ['Transformed mermaid blocks', renderDebug.transformedMermaidBlocks],
      ['Output has .mermaid div', yesNo(renderDebug.outputHasMermaidDiv)],
      ['Output still has language-mermaid code', yesNo(renderDebug.outputHasMermaidCodeFence)],
      ['Rendered HTML length', renderDebug.htmlLength],
      ['DOM .mermaid nodes', mermaidRun.domMermaidNodes],
      ['DOM mermaid code nodes', mermaidRun.domMermaidCodeNodes],
      ['Mermaid run status', mermaidRun.status]
    ]}
    <section class="debug-panel terminal-box">
      <h2>> Mermaid Debug Panel</h2>
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

      <p class="debug-hint">Append <code>?debugMermaid=1</code> to this page URL to show this panel.</p>
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
    margin-left: 0.4rem;
    opacity: 0.5;
    border: none;
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
    opacity: 0.8;
  }
</style>
