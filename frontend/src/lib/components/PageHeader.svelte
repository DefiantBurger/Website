<script lang="ts">
	import type { Snippet } from "svelte";

  let { title, description, children }: { title: string; description?: string; children?: Snippet } = $props();
</script>

<header class="page-header">
  <h1>> {title}</h1>

  {#if description}
    <p>{description}</p>
  {/if}

  {#if children}
    {@render children()}
  {/if}
</header>

<style>
  .page-header {
    grid-column: 1 / -1;
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px dashed var(--color-text-primary);
  }

  h1 {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
  }

  p {
    font-size: 1.1rem;
    opacity: 0.9;
  }

  @media (max-width: 768px) {
    h1 {
      font-size: 1.8rem;
    }
  }
</style>