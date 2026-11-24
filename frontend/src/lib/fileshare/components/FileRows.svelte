<script lang="ts">
  import { formatBytes } from '../../format';
  import type { FileShareFile } from '../api';

  let {
    files,
    busy,
    ondownload,
  }: {
    files: FileShareFile[];
    busy: boolean;
    ondownload: (files: FileShareFile[]) => void;
  } = $props();
</script>

{#if files.length > 0}
  <ul class="rows">
    {#each files as file (file.id)}
      <li>
        <span class="name">{file.name}</span>
        <span class="actions">
          <span class="size">{formatBytes(file.sizeBytes)}</span>
          <button
            type="button"
            disabled={busy}
            aria-label="Download {file.name}"
            onclick={() => ondownload([file])}>Download</button
          >
        </span>
      </li>
    {/each}
  </ul>
  {#if files.length > 1}
    <div class="all">
      <button type="button" disabled={busy} onclick={() => ondownload(files)}>
        Download all ({files.length})
      </button>
    </div>
  {/if}
{/if}

<style>
  /* Right-aligned, under the column of per-file buttons. */
  .all {
    display: flex;
    justify-content: flex-end;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 1rem;
    padding: 0.5rem 0;
    border-bottom: var(--divider);
  }

  .name {
    flex: 1 1 12rem;
    overflow-wrap: anywhere;
  }

  /* Wraps as one unit and stays on the right when a phone splits the row. */
  .actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-left: auto;
  }

  .size {
    color: var(--color-text-muted);
    font-size: 0.9rem;
  }

  li button {
    padding: 0.35rem 0.75rem;
    font-size: 0.9rem;
  }
</style>
