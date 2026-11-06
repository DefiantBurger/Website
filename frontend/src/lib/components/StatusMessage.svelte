<script lang="ts">
  import { onMount } from 'svelte';

  let {
    kind = 'loading',
    message = '',
    compact = false
  }: {
    kind?: 'loading' | 'error' | 'success';
    message?: string;
    // Smaller box for sidebars and forms.
    compact?: boolean;
  } = $props();

  // Screen readers announce changes to a live region, not the content it is
  // inserted with, and callers mount this with the message already set. So
  // mount empty and fill in once the region is in the accessibility tree.
  let isReady = $state(false);
  onMount(() => {
    const timer = setTimeout(() => (isReady = true), 100);
    return () => clearTimeout(timer);
  });
</script>

<div
  class="status-message prompt status-message--{kind}"
  class:compact
  role={kind === 'error' ? 'alert' : 'status'}
  aria-live={kind === 'error' ? 'assertive' : 'polite'}
>
  {#if isReady}{message}{/if}
</div>

<style>
  .status-message {
    margin: 1rem 0;
    overflow-wrap: anywhere;
    white-space: pre-line;
  }

  .status-message--loading {
    color: var(--color-text-muted);
    animation: blink 1s infinite;
    font-size: 1.1rem;
  }

  .status-message--error,
  .status-message--success {
    border: 1px solid;
    padding: 1rem;
    border-radius: 3px;
  }

  .status-message--error {
    color: var(--color-error);
    background-color: var(--color-error-opacity-05);
  }

  .status-message--success {
    color: var(--color-success);
    background-color: var(--color-success-opacity-05);
  }

  .compact {
    margin: 0;
    padding: 0.45rem 0.55rem;
    font-size: 0.82rem;
    line-height: 1.4;
  }

  @keyframes blink {
    0%, 49% {
      opacity: 1;
    }

    50%, 100% {
      opacity: 0.3;
    }
  }
</style>
