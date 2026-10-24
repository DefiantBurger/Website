<script lang="ts">
  import { loadProjects } from '../lib/projects/api';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import StatusMessage from '../lib/components/StatusMessage.svelte';
  import TagList from '../lib/components/TagList.svelte';

  const projectsPromise = loadProjects();
</script>

<svelte:head>
  <title>Projects</title>
  <meta name="description" content="A collection of projects I'm proud of." />
</svelte:head>

<PageHeader title="Projects" description="A collection of work I'm proud of" />

{#await projectsPromise}
  <StatusMessage kind="loading" message="Loading projects..." />
{:then projects}
  <div class="projects-grid">
    {#each projects as project (project.slug)}
      <div class="project-item terminal-box hover-lift">
        <h3>{project.title}</h3>
        <p>{project.summary || 'Project details coming soon.'}</p>
        <TagList tags={project.tags} />
        <a href="/projects/{project.slug}" class="project-link">> View Project →</a>
      </div>
    {/each}
  </div>
{:catch}
  <StatusMessage kind="error" message="Failed to load projects" />
{/await}

<style>
  .projects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 1.5rem;
  }

  .project-item {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .project-item:hover {
    transform: translateY(-4px);
  }

  .project-item h3 {
    margin-bottom: 0.5rem;
    font-size: 1.3rem;
  }

  .project-item p {
    flex-grow: 1;
    margin-bottom: 1rem;
  }

  .project-link {
    align-self: flex-start;
  }

  @media (max-width: 768px) {
    .projects-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
