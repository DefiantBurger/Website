<script lang="ts">
  import { formatBytes } from '../../format';

  let { id, files, onchange }: { id: string; files: File[]; onchange: (files: File[]) => void } =
    $props();

  let input = $state<HTMLInputElement | null>(null);
  const totalBytes = $derived(files.reduce((sum, file) => sum + file.size, 0));

  // The input keeps its own FileList, so clear it when the selection is cleared elsewhere.
  $effect(() => {
    if (files.length === 0 && input) {
      input.value = '';
    }
  });
</script>

<div class="picker">
  <label for={id}>Files</label>
  <input
    {id}
    type="file"
    multiple
    bind:this={input}
    onchange={(event) => onchange(Array.from(event.currentTarget.files ?? []))}
  />
</div>

{#if files.length > 0}
  <div class="selection">
    <p>{files.length} file{files.length === 1 ? '' : 's'}, {formatBytes(totalBytes)}</p>
    <ul>
      <!-- Keyed by index: picked files can share a name (iOS calls every photo image.jpg). -->
      {#each files as file, index (index)}
        <li><span class="name">{file.name}</span> <span>{formatBytes(file.size)}</span></li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  input {
    padding: 0.6rem;
  }

  input::file-selector-button {
    margin-right: 1rem;
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--color-text-primary);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
    font: inherit;
  }

  .selection {
    font-size: 0.9rem;
    color: var(--color-text-muted);
  }

  .selection p {
    margin: 0 0 0.25rem;
  }

  .selection ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .selection li {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    line-height: 1.6;
  }

  .name {
    overflow-wrap: anywhere;
  }
</style>
