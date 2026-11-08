<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, children }: { title: string; children: Snippet } = $props();
</script>

<section class="terminal-box panel">
  <h3>{title}</h3>
  {@render children()}
</section>

<style>
  .panel {
    border-width: 1px;
    margin: 0;
    padding: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  h3 {
    margin: 0;
    font-size: 1.1rem;
  }

  .panel :global(p) {
    font-size: 0.9rem;
  }

  /* Muted, but still 3:1 against the panel so the fields are visible. */
  .panel :global(input),
  .panel :global(select) {
    border-color: var(--color-text-muted);
    padding: 0.45rem 0.55rem;
    font-size: 0.85rem;
  }
</style>
