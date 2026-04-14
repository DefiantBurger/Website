<script lang="ts">
  import { onMount, tick } from 'svelte';
  import mermaid from 'mermaid';

  import { navigate, routeParams } from '../lib/router';
  import { loadProjectBySlug } from '../lib/projects/api';
  import {
    renderProjectMarkdownWithDebug,
    type MarkdownRenderDebug
  } from '../lib/projects/renderMarkdown';
  import type { ProjectDetail as ProjectDetailType } from '../lib/projects/types';
  import { recordProjectView } from '../lib/aboutYou/interactionStore';

  let loading = true;
  let error: string | null = null;
  let project: ProjectDetailType | null = null;
  let renderedHtml = '';
  let articleEl: HTMLElement | null = null;
  let currentSlug = '';
  let isMounted = false;
  let pendingMermaidRender = false;
  let currentMermaidTheme = '';
  let debugEnabled = false;
  let debugInfo: {
    slug: string;
    markdownLength: number;
    render: MarkdownRenderDebug | null;
    domMermaidNodes: number;
    domMermaidCodeNodes: number;
    firstMermaidSource: string;
    mermaidRunStatus: 'not-run' | 'success' | 'error';
    mermaidRunError: string;
  } = {
    slug: '',
    markdownLength: 0,
    render: null,
    domMermaidNodes: 0,
    domMermaidCodeNodes: 0,
    firstMermaidSource: '',
    mermaidRunStatus: 'not-run',
    mermaidRunError: ''
  };

  function resolveMermaidTheme(): 'dark' | 'default' {
    const appTheme = document.documentElement.getAttribute('data-theme');
    return appTheme === 'dark' ? 'dark' : 'default';
  }

  function configureMermaidForCurrentTheme() {
    const nextTheme = resolveMermaidTheme();
    if (nextTheme === currentMermaidTheme) {
      return;
    }

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: nextTheme
    });
    currentMermaidTheme = nextTheme;
  }

  async function loadPage() {
    loading = true;
    error = null;
    pendingMermaidRender = false;
    debugEnabled =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('debugMermaid') === '1';

    const slug = $routeParams.slug;
    if (!slug) {
      error = 'Missing project slug in route.';
      loading = false;
      return;
    }

    try {
      project = await loadProjectBySlug(slug);
      recordProjectView(slug);

      debugInfo = {
        slug,
        markdownLength: project.markdown.length,
        render: null,
        domMermaidNodes: 0,
        domMermaidCodeNodes: 0,
        firstMermaidSource: '',
        mermaidRunStatus: 'not-run',
        mermaidRunError: ''
      };

      const rendered = await renderProjectMarkdownWithDebug(project.markdown);
      renderedHtml = rendered.html;
      debugInfo.render = rendered.debug;
      pendingMermaidRender = true;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load project details.';
    } finally {
      loading = false;

      if (pendingMermaidRender) {
        await tick();
        await renderMermaidIntoArticle();
      }
    }
  }

  async function renderMermaidIntoArticle() {
    if (!articleEl) {
      return;
    }

    configureMermaidForCurrentTheme();

    const nodes = Array.from(articleEl.querySelectorAll<HTMLElement>('.mermaid'));
    const codeNodes = Array.from(
      articleEl.querySelectorAll<HTMLElement>('pre > code.language-mermaid')
    );

    debugInfo.domMermaidNodes = nodes.length;
    debugInfo.domMermaidCodeNodes = codeNodes.length;
    debugInfo.firstMermaidSource =
      nodes[0]?.textContent?.trim().slice(0, 220) ??
      codeNodes[0]?.textContent?.trim().slice(0, 220) ??
      '';

    if (nodes.length > 0) {
      try {
        for (const node of nodes) {
          if (!node.dataset.mermaidSource) {
            node.dataset.mermaidSource = node.textContent?.trim() ?? '';
          }

          node.removeAttribute('data-processed');
          node.textContent = node.dataset.mermaidSource;
        }

        await mermaid.run({
          nodes
        });
        debugInfo.mermaidRunStatus = 'success';
      } catch (mermaidError) {
        debugInfo.mermaidRunStatus = 'error';
        debugInfo.mermaidRunError =
          mermaidError instanceof Error ? mermaidError.message : String(mermaidError);
        console.error('Mermaid rendering failed', mermaidError);
      }
    } else {
      debugInfo.mermaidRunStatus = 'not-run';
    }

    if (debugEnabled) {
      console.group('Mermaid Debug');
      console.log('slug', debugInfo.slug);
      console.log('markdownLength', debugInfo.markdownLength);
      console.log('render', debugInfo.render);
      console.log('domMermaidNodes', debugInfo.domMermaidNodes);
      console.log('domMermaidCodeNodes', debugInfo.domMermaidCodeNodes);
      console.log('mermaidRunStatus', debugInfo.mermaidRunStatus);
      if (debugInfo.mermaidRunError) {
        console.log('mermaidRunError', debugInfo.mermaidRunError);
      }
      console.log('firstMermaidSource', debugInfo.firstMermaidSource);
      console.groupEnd();
    }
  }

  onMount(() => {
    isMounted = true;
    configureMermaidForCurrentTheme();

    const observer = new MutationObserver(async () => {
      const nextTheme = resolveMermaidTheme();
      if (nextTheme !== currentMermaidTheme && articleEl && !loading && !error) {
        await renderMermaidIntoArticle();
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    const slug = $routeParams.slug;
    if (slug && slug !== currentSlug) {
      currentSlug = slug;
      void loadPage();
    }

    return () => {
      observer.disconnect();
    };
  });

  $: {
    if (isMounted) {
      const slug = $routeParams.slug;
      if (slug && slug !== currentSlug) {
        currentSlug = slug;
        void loadPage();
      }
    }
  }

  function goBackToProjects() {
    navigate('/projects');
  }
</script>

<div class="project-detail">
  <button class="back-button" on:click={goBackToProjects}>&lt; Back to Projects</button>

  {#if loading}
    <div class="loading">> Loading project...</div>
  {:else if error}
    <div class="error">> {error}</div>
  {:else if project}
    <header class="project-header terminal-box">
      <h1>> {project.title}</h1>
      {#if project.date}
        <p class="project-date">{project.date}</p>
      {/if}

      {#if project.tags.length > 0}
        <div class="tag-list">
          {#each project.tags as tag}
            <span class="tag">{tag}</span>
          {/each}
        </div>
      {/if}

      <div class="project-links">
        {#if project.repo}
          <a href={project.repo} target="_blank" rel="noreferrer">Repository</a>
        {/if}
        {#if project.demo}
          <a href={project.demo} target="_blank" rel="noreferrer">Live Demo</a>
        {/if}
      </div>
    </header>

    <article class="project-content terminal-box" bind:this={articleEl}>
      {@html renderedHtml}
    </article>

    {#if debugEnabled}
      <section class="debug-panel terminal-box">
        <h2>> Mermaid Debug Panel</h2>
        <p><strong>Slug:</strong> {debugInfo.slug}</p>
        <p><strong>Markdown length:</strong> {debugInfo.markdownLength}</p>

        {#if debugInfo.render}
          <p><strong>Input has mermaid fence:</strong> {debugInfo.render.inputHasMermaidFence ? 'yes' : 'no'}</p>
          <p><strong>Transformed mermaid blocks:</strong> {debugInfo.render.transformedMermaidBlocks}</p>
          <p><strong>Output has .mermaid div:</strong> {debugInfo.render.outputHasMermaidDiv ? 'yes' : 'no'}</p>
          <p><strong>Output still has language-mermaid code:</strong> {debugInfo.render.outputHasMermaidCodeFence ? 'yes' : 'no'}</p>
          <p><strong>Rendered HTML length:</strong> {debugInfo.render.htmlLength}</p>
        {/if}

        <p><strong>DOM .mermaid nodes:</strong> {debugInfo.domMermaidNodes}</p>
        <p><strong>DOM mermaid code nodes:</strong> {debugInfo.domMermaidCodeNodes}</p>
        <p><strong>Mermaid run status:</strong> {debugInfo.mermaidRunStatus}</p>

        {#if debugInfo.mermaidRunError}
          <pre class="debug-error">{debugInfo.mermaidRunError}</pre>
        {/if}

        {#if debugInfo.firstMermaidSource}
          <p><strong>First Mermaid source preview:</strong></p>
          <pre>{debugInfo.firstMermaidSource}</pre>
        {/if}

        <p class="debug-hint">Append <code>?debugMermaid=1</code> to this page URL to show this panel.</p>
      </section>
    {/if}
  {/if}
</div>

<style>
  .project-detail {
    animation: fadeIn 0.35s ease-in;
  }

  @keyframes fadeIn {
    from {
      opacity: 0.5;
    }
    to {
      opacity: 1;
    }
  }

  .back-button {
    margin-bottom: 1rem;
  }

  .project-date {
    opacity: 0.8;
    margin-bottom: 1rem;
  }

  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .tag {
    border: 1px solid var(--color-text-primary);
    padding: 0.15rem 0.45rem;
    border-radius: 3px;
    font-size: 0.85rem;
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
