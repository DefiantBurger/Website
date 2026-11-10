<script lang="ts">
  import { projects } from '../lib/projects/content';
  import LinkCard from '../lib/components/LinkCard.svelte';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import TagList from '../lib/components/TagList.svelte';
</script>

<svelte:head>
  <title>Projects · JosephCicalese.com</title>
  <meta name="description" content="A collection of projects I'm proud of." />
</svelte:head>

<PageHeader title="Projects" description="A collection of work I'm proud of" />

<div class="auto-grid" style:--grid-min="350px" style:--grid-repeat="auto-fill">
  {#each projects as project (project.slug)}
    <LinkCard title={project.title} href="/projects/{project.slug}" cta="View Project">
      <p>{project.summary || 'Project details coming soon.'}</p>
      <TagList tags={project.tags} />
    </LinkCard>
  {/each}
</div>
