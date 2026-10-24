<script lang="ts">
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
</script>

<div
  class="status-message status-message--{kind}"
  class:compact
  role={kind === 'error' ? 'alert' : 'status'}
  aria-live={kind === 'error' ? 'assertive' : 'polite'}
>
  > {message}
</div>

<style>
  .status-message {
    margin: 1rem 0;
    overflow-wrap: anywhere;
    white-space: pre-line;
  }

  .status-message--loading {
    color: var(--color-text-primary);
    opacity: 0.7;
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
