<script lang="ts">
  import { projects } from '../lib/projects/content';
  import LinkCard from '../lib/components/LinkCard.svelte';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import TagList from '../lib/components/TagList.svelte';
  import { pathFor } from '../lib/routeDefinitions';
</script>

<PageHeader title="Projects" description="A collection of work I'm proud of" />

<div class="auto-grid" style:--grid-min="350px" style:--grid-repeat="auto-fill">
  {#each projects as project (project.slug)}
    <LinkCard
      title={project.title}
      href={pathFor('projectDetail', { slug: project.slug })}
      cta="View Project"
    >
      <p>{project.summary || 'Project details coming soon.'}</p>
      <TagList tags={project.tags} />
    </LinkCard>
  {/each}
</div>
