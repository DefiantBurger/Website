<script lang="ts">
  import { formatBytes } from '../../format';
  import type { UploadProgress } from '../api';

  let { progress, files }: { progress: UploadProgress; files: File[] } = $props();

  const PHASE_LABELS: Record<UploadProgress['phase'], string> = {
    encrypting: 'Encrypting',
    uploading: 'Uploading',
    storing: 'Storing',
  };
  const { fileIndex, phase, sentBytes, totalBytes } = $derived(progress);
</script>

<div class="upload-progress">
  <p class="progress-file">
    {PHASE_LABELS[phase]}
    {files.length > 1 ? `${fileIndex + 1}/${files.length}:` : ''}
    {files[fileIndex]?.name}
  </p>
  <!-- max can't be 0, which a batch of empty files would give. -->
  <progress aria-label="Upload progress" max={totalBytes || 1} value={sentBytes}></progress>
  <p class="meta">
    {totalBytes ? Math.floor((sentBytes / totalBytes) * 100) : 100}% ({formatBytes(sentBytes)} / {formatBytes(
      totalBytes,
    )})
  </p>
</div>

<style>
  .upload-progress {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  p {
    margin: 0;
  }

  .progress-file {
    overflow-wrap: anywhere;
  }

  .meta {
    color: var(--color-text-muted);
    font-size: 0.9rem;
  }

  progress {
    appearance: none;
    width: 100%;
    height: 1rem;
    border: 1px solid var(--color-text-primary);
    border-radius: 3px;
    background: var(--color-bg-dark);
    color: var(--color-text-primary);
  }

  /* Each engine styles its own pseudo-elements, and one rule can't list both. */
  progress::-webkit-progress-bar {
    background: var(--color-bg-dark);
  }

  progress::-webkit-progress-value {
    background: var(--color-text-primary);
  }

  progress::-moz-progress-bar {
    background: var(--color-text-primary);
  }

  /* Light mode's text color is a dark slate, which reads as a gray bar. */
  :global(:root[data-theme='light']) progress::-webkit-progress-value {
    background: var(--color-success);
  }

  :global(:root[data-theme='light']) progress::-moz-progress-bar {
    background: var(--color-success);
  }
</style>
