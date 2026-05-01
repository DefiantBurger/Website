<script lang="ts">
  import { onMount } from 'svelte';
  import { navigate } from '../lib/router';
  import { loadProjects } from '../lib/projects/api';
  import type { ProjectSummary } from '../lib/projects/types';

  let projects: ProjectSummary[] = [];
  let loading = false;
  let error: string | null = null;

  onMount(async () => {
    loading = true;
    try {
      projects = await loadProjects();
    } catch (e) {
      error = 'Failed to load projects';
    } finally {
      loading = false;
    }
  });

  function openProject(slug: string) {
    navigate(`/projects/${slug}`);
  }
</script>

<svelte:head>
  <title>Projects</title>
  <meta name="description" content="A collection of projects I'm proud of." />
</svelte:head>

<div class="projects">
  <header class="page-header">
    <h1>> Projects</h1>
    <p>A collection of work I'm proud of</p>
  </header>

  {#if loading}
    <div class="loading">> Loading projects...</div>
  {:else if error}
    <div class="error">> {error}</div>
  {:else}
    <div class="projects-grid">
      {#each projects as project}
        <div class="project-item terminal-box">
          <h3>{project.title}</h3>
          <p>{project.summary || 'Project details coming soon.'}</p>

          {#if project.tags.length > 0}
            <div class="tag-list">
              {#each project.tags as tag}
                <span class="tag">{tag}</span>
              {/each}
            </div>
          {/if}

          <a
            href={`/projects/${project.slug}`}
            class="project-link"
            on:click={(e) => {
              e.preventDefault();
              openProject(project.slug);
            }}
          >
            > View Project →
          </a>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .projects {
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

  .page-header {
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px dashed var(--color-text-primary);
  }

  .page-header h1 {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
  }

  .page-header p {
    font-size: 1.1rem;
    opacity: 0.9;
  }

  .projects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 1.5rem;
  }

  .project-item {
    display: flex;
    flex-direction: column;
    height: 100%;
    transition: all 0.2s ease;
  }

  .project-item:hover {
    box-shadow: 0 0 20px var(--color-primary-opacity-30);
    transform: translateY(-4px);
  }

  .project-item h3 {
    margin-top: 0;
    margin-bottom: 0.5rem;
    font-size: 1.3rem;
  }

  .project-item p {
    flex-grow: 1;
    margin-bottom: 1rem;
  }

  .project-link {
    display: inline-block;
    align-self: flex-start;
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
    opacity: 0.95;
  }

  .loading {
    color: var(--color-text-primary);
    opacity: 0.7;
    animation: blink 1s infinite;
    font-size: 1.1rem;
    margin: 2rem 0;
  }

  @keyframes blink {
    0%, 49% {
      opacity: 1;
    }
    50%, 100% {
      opacity: 0.3;
    }
  }

  .error {
    color: var(--color-error);
    border: 1px solid var(--color-error);
    padding: 1rem;
    border-radius: 3px;
    background-color: var(--color-error-opacity-05);
    margin: 1rem 0;
  }

  @media (max-width: 768px) {
    .page-header h1 {
      font-size: 1.8rem;
    }

    .projects-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
