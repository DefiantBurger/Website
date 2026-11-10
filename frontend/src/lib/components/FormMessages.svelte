<script lang="ts">
  import StatusMessage from './StatusMessage.svelte';

  // Both can show at once, e.g. a partial success.
  let { error, success }: { error: string | null; success: string | null } = $props();
</script>

{#if error}
  <StatusMessage kind="error" message={error} compact />
{/if}
{#if success}
  <StatusMessage kind="success" message={success} compact />
{/if}
