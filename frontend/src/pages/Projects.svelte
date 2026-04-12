<script lang="ts">
  import { onMount } from 'svelte';

  interface Project {
    title: string;
    description: string;
    link?: string;
  }

  let projects: Project[] = [];
  let loading = false;
  let error: string | null = null;

  onMount(async () => {
    loading = true;
    try {
      // Placeholder: will connect to API later
      projects = [
        {
          title: 'Personal Website',
          description: 'A minimal green terminal aesthetic website built with Flask and Svelte.',
          link: '#'
        },
        {
          title: 'Project 2',
          description: 'Description coming soon...',
          link: '#'
        },
        {
          title: 'Project 3',
          description: 'Another exciting project awaiting details.',
          link: '#'
        },
        {
          title: 'Project 4',
          description: 'More work samples coming soon.',
          link: '#'
        }
      ];
    } catch (e) {
      error = 'Failed to load projects';
    } finally {
      loading = false;
    }
  });
</script>

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
          <p>{project.description}</p>
          {#if project.link}
            <a href={project.link} class="project-link">> View Project →</a>
          {/if}
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
