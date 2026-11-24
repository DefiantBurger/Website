<script lang="ts">
  let { text, label = 'Copy' }: { text: string; label?: string } = $props();

  let copyState = $state<'idle' | 'copied' | 'failed'>('idle');
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copyState = 'copied';
    } catch {
      copyState = 'failed';
    }
    clearTimeout(timer);
    timer = setTimeout(() => (copyState = 'idle'), 2000);
  }
</script>

<button type="button" class="copy" onclick={copy}>
  {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : label}
</button>

<style>
  .copy {
    padding: 0.35rem 0.75rem;
    font-size: 0.9rem;
    white-space: nowrap;
  }
</style>
