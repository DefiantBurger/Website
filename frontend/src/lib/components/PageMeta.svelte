<script lang="ts">
  import { pageTitle, type RouteMeta } from '../routeDefinitions';

  let { title, description }: RouteMeta = $props();
</script>

<svelte:head>
  <title>{pageTitle(title)}</title>
  <meta name="description" content={description} />
</svelte:head>
