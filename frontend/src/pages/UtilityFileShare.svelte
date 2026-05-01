<script lang="ts">
	import { onMount } from 'svelte';
	import {
		fetchFileShareStatus,
		formatBytes,
		downloadFileShare,
		uploadFileShare,
		listFileShareFiles,
		type FileShareStatus,
		type FileShareListItem,
	} from '../lib/fileshare/api';

	const MAX_FILE_BYTES = 100 * 1_000_000;

	let status: FileShareStatus | null = null;
	let statusError: string | null = null;
	let statusLoading = false;

	let uploadFiles: File[] = [];
	let uploadPassword = '';
	let uploadError: string | null = null;
	let uploadSuccess: string | null = null;
	let uploadBusy = false;

	let accessPassword = '';
	let accessError: string | null = null;
	let accessSuccess: string | null = null;
	let accessBusy = false;
	let accessFiles: FileShareListItem[] = [];
	let selectedFileIndex = 1;

	function formatSeconds(seconds: number): string {
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`;
	}

	async function loadStatus(): Promise<void> {
		statusLoading = true;
		statusError = null;
		try {
			status = await fetchFileShareStatus();
		} catch (error) {
			statusError = error instanceof Error ? error.message : 'Failed to load storage status.';
		} finally {
			statusLoading = false;
		}
	}

	async function handleUploadSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		uploadError = null;
		uploadSuccess = null;

		if (uploadFiles.length === 0) {
			uploadError = 'Choose at least one file to upload.';
			return;
		}

		if (!uploadPassword.trim()) {
			uploadError = 'Enter a password for the file label.';
			return;
		}

		const oversizedFiles = uploadFiles.filter((f) => f.size > MAX_FILE_BYTES);
		if (oversizedFiles.length > 0) {
			uploadError = `Files must be ${formatBytes(MAX_FILE_BYTES)} or smaller. ${oversizedFiles.length} file(s) exceeded the limit.`;
			return;
		}

		uploadBusy = true;
		try {
			const results = await uploadFileShare(uploadFiles, uploadPassword.trim());
			const fileNames = results.map((r) => r.originalFilename).join(', ');
			uploadSuccess = `Stored ${results.length} file(s): ${fileNames}.`;
			uploadPassword = '';
			uploadFiles = [];
			await loadStatus();
		} catch (error) {
			uploadError = error instanceof Error ? error.message : 'Upload failed.';
		} finally {
			uploadBusy = false;
		}
	}

	async function handleListSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		accessError = null;
		accessFiles = [];

		if (!accessPassword.trim()) {
			accessError = 'Enter the password to retrieve files.';
			return;
		}

		accessBusy = true;
		try {
			const result = await listFileShareFiles(accessPassword.trim());
			accessFiles = result.files;
			if (accessFiles.length > 0) {
				selectedFileIndex = 1;
				accessSuccess = `Found ${accessFiles.length} file(s) for this password.`;
			} else {
				accessError = 'No files found for this password.';
			}
		} catch (error) {
			accessError = error instanceof Error ? error.message : 'Failed to list files.';
		} finally {
			accessBusy = false;
		}
	}

	async function handleDownload(): Promise<void> {
		accessError = null;
		accessSuccess = null;

		if (!accessPassword.trim()) {
			accessError = 'Enter the password to retrieve the file.';
			return;
		}

		if (accessFiles.length === 0) {
			accessError = 'No files available for download.';
			return;
		}

		accessBusy = true;
		try {
			const selectedFile = accessFiles.find((f) => f.occurrenceIndex === selectedFileIndex);
			const expectedFilename = selectedFile?.originalFilename;
			
			const { blob, filename } = await downloadFileShare(
				accessPassword.trim(),
				selectedFileIndex,
				expectedFilename,
			);
			const objectUrl = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = objectUrl;
			anchor.download = filename;
			anchor.click();
			URL.revokeObjectURL(objectUrl);
			accessSuccess = `Started download for ${filename}.`;
		} catch (error) {
			accessError = error instanceof Error ? error.message : 'Download failed.';
		} finally {
			accessBusy = false;
		}
	}

	onMount(() => {
		void loadStatus();
	});
</script>

<svelte:head>
	<title>File Share</title>
	<meta
		name="description"
		content="Upload files, protect them with an access key-derived label, and retrieve them through the same access key."
	/>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<h1>> File Share</h1>
			<p>
				Upload one or more files with an access key. The access key is hashed into the file label, and the
				stored file contents are encrypted at rest with a key derived from that same access key.
				Anyone with the same access key can retrieve all files until they expire.
			</p>
		</div>
	</header>

	{#if statusError}
		<div class="error">> {statusError}</div>
	{/if}

	<section class="grid">
		<form class="terminal-box panel" on:submit|preventDefault={handleUploadSubmit}>
			<h2>> Upload Files</h2>
			<p>
				Limit: 100 MB per file. Files expire after 10 minutes. When active storage approaches the 1 GB
				cap, the backend evicts oldest files to free space before accepting new uploads. Uploading with an
				existing access key will replace all previous files for that key, and the new files will be encrypted
				before they are written to disk.
			</p>

			<label>
				<span>Files (select one or more)</span>
				<input
					type="file"
					multiple
					on:change={(event) => {
						const target = event.currentTarget as HTMLInputElement;
						uploadFiles = Array.from(target.files ?? []);
					}}
				/>
			</label>

			<label>
				<span>Access Key</span>
				<input
					type="text"
					bind:value={uploadPassword}
					placeholder="Label access key"
					maxlength="128"
					autocomplete="off"
				/>
			</label>

			{#if uploadFiles.length > 0}
				<p class="file-meta">Selected: {uploadFiles.length} file(s)</p>
				<ul class="file-list">
					{#each uploadFiles as file (file.name)}
						<li>{file.name} ({formatBytes(file.size)})</li>
					{/each}
				</ul>
			{/if}

			<div class="actions">
				<button type="submit" disabled={uploadBusy}>{uploadBusy ? 'Uploading...' : 'Upload'}</button>
			</div>

			{#if uploadError}
				<div class="error">> {uploadError}</div>
			{/if}
			{#if uploadSuccess}
				<div class="success">> {uploadSuccess}</div>
			{/if}
		</form>

		<form class="terminal-box panel" on:submit|preventDefault={handleListSubmit}>
			<h2>> Access Files</h2>
			<p>
				Enter the access key used for upload. The backend hashes it to locate all matching
				active files.
			</p>

			<label>
				<span>Access Key</span>
				<input
					type="text"
					bind:value={accessPassword}
					placeholder="Access key to unlock files"
					maxlength="128"
					autocomplete="off"
				/>
			</label>

			<div class="actions">
				<button type="submit" disabled={accessBusy}>{accessBusy ? 'Fetching...' : 'List Files'}</button>
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
					<button type="button" on:click={handleDownload} disabled={accessBusy}>
						{accessBusy ? 'Fetching...' : 'Download'}
					</button>
				</div>
			{/if}

			{#if accessError}
				<div class="error">> {accessError}</div>
			{/if}
			{#if accessSuccess}
				<div class="success">> {accessSuccess}</div>
			{/if}
		</form>
	</section>

	<section class="terminal-box info-panel">
		<h2>> Storage Rules</h2>
		<div class="stats">
			<div><strong>Active files</strong><span>{status?.activeFileCount ?? 0}</span></div>
			<div><strong>Retention</strong><span>{formatSeconds(status?.retentionSeconds ?? 600)}</span></div>
			<div><strong>Per-file cap</strong><span>{formatBytes(MAX_FILE_BYTES)}</span></div>
			<div><strong>Storage usage</strong><span>{status ? formatBytes(status.usedBytes) : '0 B'} used of {formatBytes(status?.maxTotalBytes ?? 1073741824)}</span></div>
		</div>
		<br />
		<p>
			Each access key hashes to one label. Uploading with an existing access key will override all
			previous files for that key. All files expire together after 10 minutes of inactivity, and the payloads
			remain encrypted on disk using a key derived from the same access key.
		</p>
	</section>
</div>

<style>
	.page {
		animation: fadeIn 0.5s ease-in;
	}

	@keyframes fadeIn {
		from {
			opacity: 0.5;
		}
		to {
			opacity: 1;
		}
	}

	.page-header {
		display: flex;
		gap: 1.5rem;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 2rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px dashed var(--color-text-primary);
	}

	.page-header h1 {
		font-size: 2.5rem;
		margin-bottom: 0.5rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1.5rem;
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	input[type='file'],
	input[type='text'],
	select {
		padding: 0.85rem 0.9rem;
		border: 1px solid var(--color-text-primary);
		border-radius: 3px;
		background: var(--color-bg-dark);
		color: var(--color-text-primary);
		font: inherit;
	}

	input[type='file']::file-selector-button {
		margin-right: 1rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-text-primary);
		background: var(--color-bg-surface);
		color: var(--color-text-primary);
		font: inherit;
	}

	.actions {
		display: flex;
		justify-content: flex-start;
		gap: 0.5rem;
	}

	.file-list {
		list-style: none;
		padding: 0;
		margin: 0;
		border: 1px dashed var(--color-text-primary);
		border-radius: 3px;
		background: var(--color-bg-surface);
		padding: 0.75rem;
	}

	.file-list li {
		padding: 0.4rem 0;
		font-size: 0.9rem;
		opacity: 0.9;
	}

	.file-list li:not(:last-child) {
		border-bottom: 1px dashed var(--color-primary-opacity-30);
		padding-bottom: 0.4rem;
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
		border-top: 1px dashed var(--color-primary-opacity-30);
	}

	.file-selector label {
		gap: 0.5rem;
	}

	.file-selector button {
		flex-shrink: 0;
	}

	.info-panel {
		margin-top: 1.5rem;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}

	.stats div {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 1rem;
		border: 1px dashed var(--color-primary-opacity-30);
		border-radius: 3px;
		background: var(--color-primary-opacity-10);
	}

	.stats strong {
		font-size: 0.9rem;
	}

	.stats span {
		font-size: 1.1rem;
	}

	@media (max-width: 900px) {
		.page-header,
		.grid,
		.stats {
			grid-template-columns: 1fr;
			flex-direction: column;
		}
	}

	@media (max-width: 768px) {
		.page-header h1 {
			font-size: 1.8rem;
		}
	}
</style>