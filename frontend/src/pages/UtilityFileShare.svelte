<script lang="ts" module>
  import type { PageLayout } from '../lib/router.svelte';

  export const layout: PageLayout = { wide: true };
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import {
    fetchFileShareStatus,
    downloadFileShare,
    uploadFileShare,
    listFileShareFiles,
    type FileShareStatus,
    type FileShareRecord,
  } from '../lib/fileshare/api';
  import { errorMessage } from '../lib/api';
  import { formatBytes, formatDuration, formatMinutes } from '../lib/format';
  import { AsyncTask } from '../lib/asyncTask.svelte';
  import { saveBlob } from '../lib/download';
  import FormMessages from '../lib/components/FormMessages.svelte';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import Panel from '../lib/components/Panel.svelte';
  import { routeDefinitions } from '../lib/routeDefinitions';
  import StatusMessage from '../lib/components/StatusMessage.svelte';

  let status = $state<FileShareStatus | null>(null);
  const statusTask = new AsyncTask('Failed to load storage status.');

  let uploadFiles = $state<File[]>([]);
  let uploadPassword = $state('');
  const upload = new AsyncTask('Upload failed.');
  let uploadInput = $state<HTMLInputElement | null>(null);

  let accessPassword = $state('');
  // List and download share one task, so only one access request runs at a time.
  const access = new AsyncTask("Couldn't retrieve files.");
  let accessFiles = $state<FileShareRecord[]>([]);
  let selectedFileIndex = $state(1);

  // Limits come from the backend, so the page can't drift from it; '—' until loaded.
  const STAT_ROWS: [label: string, value: (status: FileShareStatus) => string][] = [
    ['Active files', (s) => String(s.activeFileCount)],
    ['Retention', (s) => formatDuration(s.retentionSeconds)],
    ['Per-file cap', (s) => formatBytes(s.maxFileBytes)],
    ['Storage used', (s) => `${formatBytes(s.usedBytes)} / ${formatBytes(s.maxTotalBytes)}`],
  ];
  const stats = $derived(STAT_ROWS.map(([label, value]) => [label, status ? value(status) : '—']));

  const limitsIntro = $derived(
    status
      ? `Limit: ${formatBytes(status.maxFileBytes, { trim: true })} per file. Files expire after ${formatMinutes(status.retentionSeconds)}. When active storage approaches the ${formatBytes(status.maxTotalBytes, { trim: true })} cap,`
      : 'When active storage is nearly full,',
  );

  async function loadStatus(): Promise<void> {
    await statusTask.run(async () => {
      status = await fetchFileShareStatus();
    });
  }

  async function handleUploadSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (uploadFiles.length === 0) {
      upload.fail('Choose at least one file to upload.');
      return;
    }

    if (!uploadPassword.trim()) {
      upload.fail('Enter an access key for the file.');
      return;
    }

    // Without the status yet, skip the early check; the server still rejects with a 413.
    const maxFileBytes = status?.maxFileBytes ?? Infinity;
    const oversizedCount = uploadFiles.filter((f) => f.size > maxFileBytes).length;
    if (oversizedCount > 0) {
      upload.fail(
        `Files must be ${formatBytes(maxFileBytes, { trim: true })} or smaller. ${oversizedCount} file(s) exceeded the limit.`,
      );
      return;
    }

    await upload.run(async () => {
      const result = await uploadFileShare(uploadFiles, uploadPassword.trim());
      if (result.ok) {
        const fileNames = result.uploaded.map((r) => r.originalFilename).join(', ');
        upload.success = `Stored ${result.uploaded.length} file(s): ${fileNames}.`;
        if (!result.oldFilesRemoved) {
          upload.error =
            "Couldn't remove this key's previous files; they stay listed until they expire.";
        }
        uploadPassword = '';
        uploadFiles = [];
        // The input keeps its own FileList, so clear it to match `uploadFiles`.
        if (uploadInput) {
          uploadInput.value = '';
        }
      } else {
        const reason = errorMessage(result.error, 'Upload failed.');
        const outcome =
          result.uploadedCount === 0 || result.rolledBack
            ? 'Nothing was replaced; the key still has its previous files.'
            : `The ${result.uploadedCount} file(s) stored before it couldn't be removed and are listed alongside the previous files until they expire.`;
        upload.error = `Upload failed on ${result.failedFile}: ${reason}\n${outcome}`;
      }
    });
    await loadStatus();
  }

  /** The trimmed access key, or null (with `missingKeyMessage` shown) if it is empty. */
  function requireAccessKey(missingKeyMessage: string): string | null {
    const key = accessPassword.trim();
    if (!key) {
      access.fail(missingKeyMessage);
      return null;
    }
    return key;
  }

  async function handleListSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const key = requireAccessKey('Enter the access key to retrieve files.');
    if (!key) {
      accessFiles = [];
      return;
    }

    await access.run(async () => {
      accessFiles = []; // so a failed lookup doesn't leave the previous key's files listed
      // The API answers 404 when there are none, so this list is never empty.
      accessFiles = (await listFileShareFiles(key)).files;
      // Indices don't restart at 1: a replaced batch keeps counting up.
      selectedFileIndex = accessFiles[0].occurrenceIndex;
      access.success = `Found ${accessFiles.length} file(s) for this access key.`;
    });
  }

  async function startDownloads(files: FileShareRecord[]): Promise<void> {
    const key = requireAccessKey('Enter the access key to retrieve files.');
    if (!key) {
      return;
    }
    if (files.length === 0) {
      access.fail('No files available for download.');
      return;
    }

    await access.run(async () => {
      const failures: string[] = [];
      for (const file of files) {
        try {
          saveBlob(await downloadFileShare(key, file.occurrenceIndex), file.originalFilename);
        } catch (error) {
          failures.push(`- ${file.originalFilename}: ${errorMessage(error, 'Download failed.')}`);
        }
      }

      const succeeded = files.length - failures.length;
      if (succeeded > 0) {
        access.success = `Started ${succeeded} download${succeeded === 1 ? '' : 's'}.`;
      }
      if (failures.length > 0) {
        access.error = `${succeeded} succeeded, ${failures.length} failed:\n${failures.join('\n')}`;
      }
    });
  }

  onMount(() => {
    void loadStatus();
  });
</script>

{#snippet accessKeyInput(getValue: () => string, setValue: (value: string) => void)}
  <label>
    <span>Access Key</span>
    <input
      type="text"
      bind:value={getValue, setValue}
      placeholder="Access key to unlock files"
      maxlength="128"
      autocomplete="off"
    />
  </label>
{/snippet}

<PageHeader
  title="Utilities / {routeDefinitions.fileShare.meta.title}"
  description="Upload one or more files with an access key. The access key is hashed into the file label, and the stored file contents are encrypted at rest with a key derived from that same access key. Anyone with the same access key can retrieve all files until they expire."
/>

{#if statusTask.error}
  <StatusMessage kind="error" message={statusTask.error} />
{/if}

<section class="auto-grid" style:--grid-min="25rem">
  <Panel element="form" title="Upload Files" onsubmit={handleUploadSubmit}>
    <p>
      {limitsIntro} the backend evicts oldest files to free space before accepting new uploads. Uploading
      with an existing access key replaces all previous files for that key.
    </p>

    <label>
      <span>Files (select one or more)</span>
      <input
        type="file"
        multiple
        bind:this={uploadInput}
        onchange={(event) => (uploadFiles = Array.from(event.currentTarget.files ?? []))}
      />
    </label>

    {@render accessKeyInput(
      () => uploadPassword,
      (value) => (uploadPassword = value),
    )}

    {#if uploadFiles.length > 0}
      <p class="file-meta">Selected: {uploadFiles.length} file(s)</p>
      <ul class="file-list">
        <!-- Keyed by index: picked files can share a name (iOS calls every photo image.jpg). -->
        {#each uploadFiles as file, index (index)}
          <li>{file.name} ({formatBytes(file.size)})</li>
        {/each}
      </ul>
    {/if}

    <div>
      <button type="submit" disabled={upload.busy}>{upload.busy ? 'Uploading...' : 'Upload'}</button
      >
    </div>

    <FormMessages error={upload.error} success={upload.success} />
  </Panel>

  <Panel element="form" title="Access Files" onsubmit={handleListSubmit}>
    <p>
      Enter the access key used for upload. The backend hashes it to locate all matching active
      files.
    </p>

    {@render accessKeyInput(
      () => accessPassword,
      (value) => (accessPassword = value),
    )}

    <div>
      <button type="submit" disabled={access.busy}
        >{access.busy ? 'Fetching...' : 'List Files'}</button
      >
    </div>

    {#if accessFiles.length > 0}
      <div class="file-selector">
        <label>
          <span>Select file to download</span>
          <select bind:value={selectedFileIndex}>
            {#each accessFiles as file (file.occurrenceIndex)}
              <option value={file.occurrenceIndex}>
                {file.originalFilename} ({formatBytes(file.sizeBytes)})
              </option>
            {/each}
          </select>
        </label>
        <button
          type="button"
          onclick={() =>
            startDownloads(
              accessFiles.filter((file) => file.occurrenceIndex === selectedFileIndex),
            )}
          disabled={access.busy}
        >
          {access.busy ? 'Fetching...' : 'Download'}
        </button>
        <button type="button" onclick={() => startDownloads(accessFiles)} disabled={access.busy}>
          {access.busy ? 'Fetching...' : 'Download All'}
        </button>
      </div>
    {/if}

    <FormMessages error={access.error} success={access.success} />
  </Panel>
</section>

<Panel title="Storage Info" class="info-panel">
  <dl class="stats">
    {#each stats as [label, value] (label)}
      <div>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    {/each}
  </dl>
</Panel>

<style>
  label {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  input,
  select {
    padding: 0.85rem 0.9rem;
  }

  input[type='file']::file-selector-button {
    margin-right: 1rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-text-primary);
    background: var(--color-bg-surface);
    color: var(--color-text-primary);
    font: inherit;
  }

  .file-list {
    list-style: none;
    border: 1px dashed var(--color-text-primary);
    border-radius: 3px;
    background: var(--color-bg-surface);
    padding: 0.75rem;
  }

  .file-list li {
    padding: 0.4rem 0;
    font-size: 0.9rem;
    opacity: 0.9;
    overflow-wrap: break-word;
  }

  .file-list li:not(:last-child) {
    border-bottom: var(--divider);
    margin-bottom: 0.4rem;
  }

  .file-meta {
    opacity: 0.85;
  }

  .file-selector {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 0.75rem;
    border-top: var(--divider);
  }

  :global(.info-panel) {
    margin-top: 1.5rem;
    container-type: inline-size;
  }

  /* Explicit 1/2/4 steps so a stat is never left alone on a row; 4 columns need
     ~80rem for the longest row ("999.9 MB / 1.00 GB") to stay on one line. */
  .stats {
    display: grid;
    grid-template-columns: 1fr;
    column-gap: 2rem;
    margin: 0;
  }

  @container (min-width: 40rem) {
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @container (min-width: 80rem) {
    .stats {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  .stats div {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0 1rem;
    padding: 0.4rem 0;
    border-bottom: var(--divider);
  }

  .stats dt {
    opacity: 0.75;
  }

  .stats dd {
    margin: 0;
  }
</style>
