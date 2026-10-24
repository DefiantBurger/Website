<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    description,
    children,
    actions
  }: {
    title: string;
    description?: string;
    // Extra content under the description.
    children?: Snippet;
    // Controls shown to the right of the title.
    actions?: Snippet;
  } = $props();
</script>

<header class="page-header" class:has-body={description || children} class:has-actions={actions}>
  <div class="main">
    <h1>> {title}</h1>

    {#if description}
      <p>{description}</p>
    {/if}

    {@render children?.()}
  </div>

  {#if actions}
    <div class="actions">
      {@render actions()}
    </div>
  {/if}
</header>

<style>
  .page-header {
    grid-column: 1 / -1;
    margin-bottom: 2rem;
  }

  /* Only lay out as a row when needed; flex would stop the h1 margin collapsing. */
  .page-header.has-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1.5rem;
  }

  .page-header.has-body {
    padding-bottom: 1rem;
    border-bottom: 1px dashed var(--color-text-primary);
  }

  .main {
    flex: 1;
    min-width: 0;
  }

  h1 {
    font-size: 2.5rem;
    margin-bottom: 1rem;
  }

  p {
    font-size: 1.1rem;
    opacity: 0.9;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  @media (max-width: 768px) {
    h1 {
      font-size: 1.8rem;
    }
  }
</style>
