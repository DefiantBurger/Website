<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    href,
    cta,
    headingLevel = 2,
    button = false,
    children,
  }: {
    title: string;
    href: string;
    cta: string;
    headingLevel?: 2 | 3;
    /** Show the CTA as a full-width button instead of a prompt-style link. */
    button?: boolean;
    children?: Snippet;
  } = $props();

  // Generic CTAs ("View Project") get the title appended so each link names its destination.
  const label = $derived(cta.includes(title) ? undefined : `${cta}: ${title}`);
</script>

<div class="link-card terminal-box hover-lift clickable-card">
  <svelte:element this={`h${headingLevel}`} class="card-title">{title}</svelte:element>
  <div class="card-body">{@render children?.()}</div>
  <a
    {href}
    class="stretched-link"
    class:button
    class:prompt={!button}
    class:card-link={!button}
    aria-label={label}
    >{cta}{#if !button}<span aria-hidden="true">&nbsp;→</span>{/if}</a
  >
</div>

<style>
  .link-card {
    display: flex;
    flex-direction: column;
    height: 100%;
    margin: 0;
  }

  .card-title {
    margin: 0 0 0.5rem;
    font-size: 1.3rem;
    font-weight: bold;
    line-height: normal;
    letter-spacing: normal;
  }

  /* Takes the card's spare height so CTAs (and tags) line up across a row. */
  .card-body {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .card-body > :global(:first-child) {
    flex-grow: 1;
  }

  /* Children like TagList carry their own bottom margin; the body already spaces the CTA. */
  .card-body > :global(:last-child) {
    margin-bottom: 0;
  }

  .card-link {
    align-self: flex-start;
  }

  .button {
    width: 100%;
  }
</style>
