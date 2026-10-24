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
	import { errorMessage } from '../lib/api';
	import { saveBlob } from '../lib/download';
	import PageHeader from '../lib/components/PageHeader.svelte';
	import StatusMessage from '../lib/components/StatusMessage.svelte';

	const MAX_FILE_BYTES = 100 * 1_000_000;

	let status = $state<FileShareStatus | null>(null);
	let statusError = $state<string | null>(null);

	let uploadFiles = $state<File[]>([]);
	let uploadPassword = $state('');
	let uploadError = $state<string | null>(null);
	let uploadSuccess = $state<string | null>(null);
	let uploadBusy = $state(false);

	let accessPassword = $state('');
	let accessError = $state<string | null>(null);
	let accessSuccess = $state<string | null>(null);
	let accessBusy = $state(false);
	let accessFiles = $state<FileShareListItem[]>([]);
	let selectedFileIndex = $state(1);

	const stats = $derived([
		['Active files', String(status?.activeFileCount ?? 0)],
		['Retention', formatSeconds(status?.retentionSeconds ?? 600)],
		['Per-file cap', formatBytes(MAX_FILE_BYTES)],
		[
			'Storage usage',
			`${formatBytes(status?.usedBytes ?? 0)} used of ${formatBytes(status?.maxTotalBytes ?? 1_073_741_824)}`,
		],
	]);

	function formatSeconds(seconds: number): string {
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`;
	}

	async function loadStatus(): Promise<void> {
		statusError = null;
		try {
			status = await fetchFileShareStatus();
		} catch (error) {
			statusError = errorMessage(error, 'Failed to load storage status.');
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
			uploadError = 'Enter an access key for the file.';
			return;
		}

		const oversizedCount = uploadFiles.filter((f) => f.size > MAX_FILE_BYTES).length;
		if (oversizedCount > 0) {
			uploadError = `Files must be ${formatBytes(MAX_FILE_BYTES)} or smaller. ${oversizedCount} file(s) exceeded the limit.`;
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
			uploadError = errorMessage(error, 'Upload failed.');
		} finally {
			uploadBusy = false;
		}
	}

	/** Clear access messages and return the trimmed key, or null (with an error shown) if it is missing. */
	function startAccess(missingKeyMessage: string): string | null {
		accessError = null;
		accessSuccess = null;
		const key = accessPassword.trim();
		if (!key) {
			accessError = missingKeyMessage;
			return null;
		}
		return key;
	}

	async function handleListSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		accessFiles = [];
		const key = startAccess('Enter the access key to retrieve files.');
		if (!key) {
			return;
		}

		accessBusy = true;
		try {
			accessFiles = (await listFileShareFiles(key)).files;
			if (accessFiles.length > 0) {
				selectedFileIndex = 1;
				accessSuccess = `Found ${accessFiles.length} file(s) for this access key.`;
			} else {
				accessError = 'No files found for this access key.';
			}
		} catch (error) {
			accessError = errorMessage(error, 'Failed to list files.');
		} finally {
			accessBusy = false;
		}
	}

	async function downloadFile(key: string, file: FileShareListItem): Promise<void> {
		const { blob, filename } = await downloadFileShare(key, file.occurrenceIndex, file.originalFilename);
		saveBlob(blob, filename);
	}

	async function handleDownload(): Promise<void> {
		const key = startAccess('Enter the access key to retrieve the file.');
		const selectedFile = accessFiles.find((f) => f.occurrenceIndex === selectedFileIndex);
		if (!key || !selectedFile) {
			accessError ??= 'No files available for download.';
			return;
		}

		accessBusy = true;
		try {
			await downloadFile(key, selectedFile);
			accessSuccess = `Started download for ${selectedFile.originalFilename}.`;
		} catch (error) {
			accessError = errorMessage(error, 'Download failed.');
		} finally {
			accessBusy = false;
		}
	}

	async function handleDownloadAll(): Promise<void> {
		const key = startAccess('Enter the access key to retrieve files.');
		if (!key || accessFiles.length === 0) {
			accessError ??= 'No files available for download.';
			return;
		}

		let succeeded = 0;
		const failures: string[] = [];

		accessBusy = true;
		for (const file of accessFiles) {
			try {
				await downloadFile(key, file);
				succeeded += 1;
			} catch (error) {
				failures.push(`- ${file.originalFilename}: ${errorMessage(error, 'Download failed.')}`);
			}
		}
		accessBusy = false;

		const summaryHeader = `${succeeded} succeeded, ${failures.length} failed`;
		if (failures.length === 0) {
			accessSuccess = `${summaryHeader}.`;
			return;
		}

		accessError = `${summaryHeader}:\n${failures.join('\n')}`;
		if (succeeded > 0) {
			accessSuccess = `Started ${succeeded} download(s).`;
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

{#snippet messages(error: string | null, success: string | null)}
	{#if error}
		<StatusMessage kind="error" message={error} compact />
	{/if}
	{#if success}
		<StatusMessage kind="success" message={success} compact />
	{/if}
{/snippet}

<PageHeader
	title="Utilities / File Share"
	description="Upload one or more files with an access key. The access key is hashed into the file label, and the stored file contents are encrypted at rest with a key derived from that same access key. Anyone with the same access key can retrieve all files until they expire."
/>

{#if statusError}
	<StatusMessage kind="error" message={statusError} />
{/if}

<section class="grid">
	<form class="terminal-box panel" onsubmit={handleUploadSubmit}>
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
				onchange={(event) => (uploadFiles = Array.from(event.currentTarget.files ?? []))}
			/>
		</label>

		{@render accessKeyInput(() => uploadPassword, (value) => (uploadPassword = value))}

		{#if uploadFiles.length > 0}
			<p class="file-meta">Selected: {uploadFiles.length} file(s)</p>
			<ul class="file-list">
				{#each uploadFiles as file (file.name)}
					<li>{file.name} ({formatBytes(file.size)})</li>
				{/each}
			</ul>
		{/if}

		<div>
			<button type="submit" disabled={uploadBusy}>{uploadBusy ? 'Uploading...' : 'Upload'}</button>
		</div>

		{@render messages(uploadError, uploadSuccess)}
	</form>

	<form class="terminal-box panel" onsubmit={handleListSubmit}>
		<h2>> Access Files</h2>
		<p>
			Enter the access key used for upload. The backend hashes it to locate all matching
			active files.
		</p>

		{@render accessKeyInput(() => accessPassword, (value) => (accessPassword = value))}

		<div>
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
				<button type="button" onclick={handleDownload} disabled={accessBusy}>
					{accessBusy ? 'Fetching...' : 'Download'}
				</button>
				<button type="button" onclick={handleDownloadAll} disabled={accessBusy}>
					{accessBusy ? 'Fetching...' : 'Download All'}
				</button>
			</div>
		{/if}

		{@render messages(accessError, accessSuccess)}
	</form>
</section>

<section class="terminal-box info-panel">
	<h2>> Storage Rules</h2>
	<div class="stats">
		{#each stats as [label, value] (label)}
			<div><strong>{label}</strong><span>{value}</span></div>
		{/each}
	</div>
	<p>
		Each access key hashes to one label. Uploading with an existing access key will override all
		previous files for that key. All files expire together after 10 minutes of inactivity, and the payloads
		remain encrypted on disk using a key derived from the same access key.
	</p>
</section>

<style>
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
		border-bottom: 1px dashed var(--color-primary-opacity-30);
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

	.info-panel {
		margin-top: 1.5rem;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
		margin-bottom: 1.5rem;
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
		.grid,
		.stats {
			grid-template-columns: 1fr;
		}
	}
</style>
