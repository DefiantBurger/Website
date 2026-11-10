<script lang="ts">
  import { SITE_NAME, type RouteMeta } from '../routeDefinitions';

  let { title, description }: RouteMeta = $props();
</script>

<svelte:head>
  <title>{title ? `${title} · ${SITE_NAME}` : SITE_NAME}</title>
  <meta name="description" content={description} />
</svelte:head>
