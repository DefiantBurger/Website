<script lang="ts">
  import { projects } from '../lib/projects/content';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import TagList from '../lib/components/TagList.svelte';
</script>

<svelte:head>
  <title>Projects · JosephCicalese.com</title>
  <meta name="description" content="A collection of projects I'm proud of." />
</svelte:head>

<PageHeader title="Projects" description="A collection of work I'm proud of" />

<div class="projects-grid">
  {#each projects as project (project.slug)}
    <div class="project-item terminal-box hover-lift clickable-card">
      <h2>{project.title}</h2>
      <p>{project.summary || 'Project details coming soon.'}</p>
      <TagList tags={project.tags} />
      <a
        href="/projects/{project.slug}"
        class="project-link stretched-link prompt"
        aria-label="View project: {project.title}">View Project →</a
      >
    </div>
    {/each}
</div>

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

  .project-item:hover,
  .project-item:focus-within {
    transform: translateY(-4px);
  }

  /* An h2 for heading order (h1 -> h2), styled like the card titles elsewhere. */
  .project-item h2 {
    margin: 0 0 0.5rem;
    padding-bottom: 0;
    border-bottom: none;
    font-size: 1.3rem;
    font-weight: bold;
    line-height: normal;
    letter-spacing: normal;
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
