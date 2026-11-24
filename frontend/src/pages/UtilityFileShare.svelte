<script lang="ts" module>
  import type { PageLayout } from '../lib/router.svelte';

  export const layout: PageLayout = { wide: true };
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import FormMessages from '../lib/components/FormMessages.svelte';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import Panel from '../lib/components/Panel.svelte';
  import StatusMessage from '../lib/components/StatusMessage.svelte';
  import FilePicker from '../lib/fileshare/components/FilePicker.svelte';
  import FileRows from '../lib/fileshare/components/FileRows.svelte';
  import KeyField from '../lib/fileshare/components/KeyField.svelte';
  import UploadProgressBar from '../lib/fileshare/components/UploadProgressBar.svelte';
  import { FileShareController } from '../lib/fileshare/controller.svelte';
  import { routeDefinitions } from '../lib/routeDefinitions';

  const fs = new FileShareController();

  onMount(() => {
    void fs.loadStatus();
  });
</script>

<PageHeader
  title="Utilities / {routeDefinitions.fileShare.meta.title}"
  description="Send files to anyone who has the access key. Your browser encrypts each file and its name before upload, so the server only stores ciphertext. Files expire after a few minutes, and uploading again with the same key replaces its earlier files."
/>

{#if fs.statusTask.error}
  <StatusMessage kind="error" message={fs.statusTask.error} />
{/if}

<section class="auto-grid" style:--grid-min="22rem">
  <Panel
    element="form"
    title="Upload"
    onsubmit={(event) => {
      event.preventDefault();
      void fs.sendFiles();
    }}
  >
    <FilePicker id="upload-files" files={fs.files} onchange={(files) => fs.setFiles(files)} />
    <KeyField
      id="upload-key"
      placeholder="Your own key, or Generate one"
      bind:value={fs.sendKey}
      generated={fs.showGeneratedKey ? fs.generatedKey : null}
    >
      <button type="button" onclick={() => fs.generateKey()}>Generate</button>
    </KeyField>
    <button type="submit" class="upload" disabled={fs.send.busy}>
      {fs.send.busy ? 'Uploading...' : 'Upload'}
    </button>
    {#if fs.progress}
      <UploadProgressBar progress={fs.progress} files={fs.files} />
    {/if}
    <FormMessages error={fs.send.error} success={fs.send.success} quiet />
  </Panel>

  <Panel
    element="form"
    title="Download"
    onsubmit={(event) => {
      event.preventDefault();
      void fs.list();
    }}
  >
    <KeyField id="download-key" placeholder="The key you were given" bind:value={fs.receiveKey}>
      <button type="submit" disabled={fs.receive.busy}>List files</button>
    </KeyField>
    <FileRows files={fs.listed} busy={fs.receive.busy} ondownload={(files) => fs.download(files)} />
    <FormMessages error={fs.receive.error} success={fs.receive.success} quiet />
  </Panel>
</section>

<p class="status-line">{fs.statusLine}</p>

<style>
  .upload {
    width: 100%;
  }

  .status-line {
    margin-top: 1rem;
    color: var(--color-text-muted);
    font-size: 0.9rem;
    text-align: center;
  }
</style>
