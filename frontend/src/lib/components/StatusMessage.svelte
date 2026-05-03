<script lang="ts">
  let {
    kind = 'loading',
    message = ''
  }: {
    kind?: 'loading' | 'error';
    message?: string;
  } = $props();
</script>

<div
  class={`status-message status-message--${kind}`}
  role={kind === 'error' ? 'alert' : 'status'}
  aria-live={kind === 'error' ? 'assertive' : 'polite'}
>
  > {message}
</div>

<style>
  .status-message {
    margin: 1rem 0;
  }

  .status-message--loading {
    color: var(--color-text-primary);
    opacity: 0.7;
    animation: blink 1s infinite;
    font-size: 1.1rem;
  }

  .status-message--error {
    color: var(--color-error);
    border: 1px solid var(--color-error);
    padding: 1rem;
    border-radius: 3px;
    background-color: var(--color-error-opacity-05);
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