<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = HTMLAttributes<HTMLElement> & {
    title: string;
    element?: 'section' | 'form';
    /** Smaller nested panel with a plain h3, e.g. inside another terminal box. */
    compact?: boolean;
    children: Snippet;
  };

  let {
    title,
    element = 'section',
    compact = false,
    class: className = '',
    children,
    ...rest
  }: Props = $props();
</script>

<svelte:element this={element} class="terminal-box panel {className}" class:compact {...rest}>
  {#if compact}
    <h3>{title}</h3>
  {:else}
    <h2 class="prompt section-title">{title}</h2>
  {/if}
  {@render children()}
</svelte:element>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .compact {
    border-width: 1px;
    margin: 0;
    padding: 0.8rem;
    gap: 0.55rem;
  }

  h3 {
    margin: 0;
    font-size: 1.1rem;
  }

  .compact :global(p) {
    font-size: 0.9rem;
  }

  /* Muted, but still 3:1 against the panel so the fields are visible. */
  .compact :global(input),
  .compact :global(select) {
    border-color: var(--color-text-muted);
    padding: 0.45rem 0.55rem;
    font-size: 0.85rem;
  }
</style>
