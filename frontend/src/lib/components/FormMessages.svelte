<script lang="ts">
  import StatusMessage from './StatusMessage.svelte';

  // Both can show at once, e.g. a partial success.
  let {
    error,
    success,
    quiet = false,
  }: { error: string | null; success: string | null; quiet?: boolean } = $props();
</script>

{#if error}
  <StatusMessage kind="error" message={error} compact {quiet} />
{/if}
{#if success}
  <StatusMessage kind="success" message={success} compact {quiet} />
{/if}
