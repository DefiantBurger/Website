<script lang="ts">
  import LinkCard from '../lib/components/LinkCard.svelte';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import { pathFor, routeDefinitions } from '../lib/routeDefinitions';

  const utilities = (['scheduler', 'fileShare', 'messageBoard'] as const).map((key) => ({
    ...routeDefinitions[key].meta,
    path: pathFor(key),
  }));
</script>

<div class="auto-grid" style:--grid-min="350px">
  <PageHeader title="Utilities" description="A few of my small tools and experiments." />

  {#each utilities as utility (utility.path)}
    <LinkCard title={utility.title} href={utility.path} cta="Open {utility.title}" button>
      <p>{utility.description}</p>
    </LinkCard>
  {/each}
</div>
