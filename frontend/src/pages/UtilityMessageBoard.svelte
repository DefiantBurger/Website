<script lang="ts">
	import { onMount } from 'svelte';
	import {
		fetchActiveMessages,
		postBoardMessage,
		type BoardMessage,
	} from '../lib/messageboard/api';

	const MAX_LENGTH = 280;

	let messages: BoardMessage[] = [];
	let loading = true;
	let error: string | null = null;

	let messageText = '';
	let isPosting = false;
	let postError: string | null = null;
	let postSuccess: string | null = null;

	async function loadMessages(): Promise<void> {
		loading = true;
		error = null;
		try {
			const res = await fetchActiveMessages();
			messages = res.messages;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load messages.';
		} finally {
			loading = false;
		}
	}

	async function handlePost(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		postError = null;
		postSuccess = null;

		const trimmed = messageText.trim();
		if (!trimmed) {
			postError = 'Please enter a message to broadcast.';
			return;
		}

		if (trimmed.length > MAX_LENGTH) {
			postError = `Message exceeds ${MAX_LENGTH} characters.`;
			return;
		}

		isPosting = true;
		try {
			await postBoardMessage(trimmed);
			messageText = '';
			postSuccess = 'Message posted! It will remain active on the server for ~30s.';
			await loadMessages();
		} catch (err) {
			postError = err instanceof Error ? err.message : 'Failed to post message.';
		} finally {
			isPosting = false;
		}
	}

	function formatTimestamp(isoString: string): string {
		try {
			const date = new Date(isoString);
			return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
		} catch {
			return isoString;
		}
	}

	onMount(() => {
		loadMessages();
	});
</script>

<svelte:head>
	<title>Message Board</title>
	<meta
		name="description"
		content="Ephemeral anonymous message board where notes vanish after around 30 seconds."
	/>
</svelte:head>

<div class="page page-frame">
	<header class="page-header">
		<div>
			<h1>> Utilities / Message Board</h1>
			<p>
				Post short anonymous notes to the public board. All messages are ephemeral and
				automatically expire after ~30 seconds on the server. Reload anytime to refresh active notes.
			</p>
		</div>
		<div class="header-actions">
			<button type="button" class="btn secondary reload-btn" on:click={loadMessages} disabled={loading || isPosting}>
				{loading ? 'Refreshing...' : 'Reload Board'}
			</button>
		</div>
	</header>

	<div class="board-layout">
		<!-- Main area: The Message Board -->
		<main class="feed-column">
			<div class="feed-header">
				<h2>> Active Broadcasts ({messages.length})</h2>
				<span class="expiry-pill">[ ~30s TTL ]</span>
			</div>

			{#if loading && messages.length === 0}
				<div class="terminal-box status-card">
					<p class="loading">> Fetching active broadcasts...</p>
				</div>
			{:else if error}
				<div class="error" role="alert">> {error}</div>
			{:else if messages.length === 0}
				<div class="terminal-box empty-card">
					<p class="empty-title">[ NO ACTIVE BROADCASTS ]</p>
					<p class="empty-desc">
						The board is clear right now. Post a message using the compose box on the side,
						then reload to see it before it expires!
					</p>
				</div>
			{:else}
				<div class="message-grid">
					{#each messages as msg (msg.id)}
						<article class="terminal-box message-card">
							<header class="card-meta">
								<span class="prompt-icon">></span>
								<span class="card-id">#{msg.id.slice(0, 6)}</span>
								<span class="card-time">{formatTimestamp(msg.createdAt)}</span>
							</header>
							<p class="message-text">{msg.text}</p>
						</article>
					{/each}
				</div>
			{/if}
		</main>

		<!-- Side area: Smaller Compose Box -->
		<aside class="sidebar-column">
			<form class="terminal-box compose-card" on:submit|preventDefault={handlePost}>
				<div class="compose-header">
					<h3>> Post Note</h3>
					<span class="ttl-badge">30s TTL</span>
				</div>

				<p class="compose-hint">
					Broadcasts self-destruct after ~30s. Only URL-safe characters are permitted.
				</p>

				<label for="board-message-input" class="sr-only">Message content</label>
				<textarea
					id="board-message-input"
					bind:value={messageText}
					placeholder="Type a note (vanishes in ~30s)..."
					maxlength={MAX_LENGTH}
					rows="4"
					disabled={isPosting}
				></textarea>

				<div class="compose-meta">
					<span class="char-count" class:near-limit={messageText.length > MAX_LENGTH - 30}>
						{messageText.length}/{MAX_LENGTH}
					</span>
					<button type="submit" class="btn submit-btn" disabled={isPosting || !messageText.trim()}>
						{isPosting ? 'Posting...' : 'Post Note'}
					</button>
				</div>

				{#if postError}
					<div class="error compact-alert" role="alert">> {postError}</div>
				{/if}

				{#if postSuccess}
					<div class="success compact-alert" role="status">> {postSuccess}</div>
				{/if}
			</form>
		</aside>
	</div>
</div>

<style>
	.page {
		width: 100%;
		display: flex;
		flex-direction: column;
	}

	.page-header {
		display: flex;
		gap: 1.5rem;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 2rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px dashed var(--color-text-primary);
		flex-wrap: wrap;
	}

	.page-header h1 {
		font-size: 2.5rem;
		margin-bottom: 0.5rem;
		border-bottom: none;
		padding-bottom: 0;
	}

	.page-header p {
		line-height: 1.8;
		opacity: 0.9;
		max-width: 800px;
		margin: 0;
	}

	.header-actions {
		display: flex;
		align-items: center;
	}

	.reload-btn {
		white-space: nowrap;
	}

	.btn.secondary {
		background-color: transparent;
		border-color: var(--color-text-primary);
	}

	.btn.secondary:hover {
		background-color: var(--color-primary-opacity-15);
	}

	/* Two-column layout with message board as main and small post box to the side */
	.board-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: 2rem;
		align-items: start;
		width: 100%;
	}

	.feed-column {
		min-width: 0;
	}

	.feed-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-bottom: 1px solid var(--color-text-primary);
		padding-bottom: 0.5rem;
		margin-bottom: 1.25rem;
	}

	.feed-header h2 {
		margin: 0;
		border: 0;
		font-size: 1.4rem;
	}

	.expiry-pill {
		font-size: 0.85rem;
		padding: 0.2rem 0.55rem;
		border: 1px solid var(--color-text-primary);
		border-radius: 2px;
		background: var(--color-primary-opacity-10);
	}

	/* Grid of active message cards */
	.message-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 1.25rem;
	}

	.message-card {
		margin: 0;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		background-color: var(--color-bg-surface);
		border-left: 3px solid var(--color-text-primary);
		min-height: 110px;
		transition: transform 0.15s ease, box-shadow 0.15s ease;
	}

	.message-card:hover {
		box-shadow: 0 0 12px var(--color-primary-opacity-20);
		transform: translateY(-2px);
	}

	.card-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		opacity: 0.75;
		border-bottom: 1px dashed var(--color-primary-opacity-30);
		padding-bottom: 0.35rem;
	}

	.prompt-icon {
		font-weight: bold;
		color: var(--color-text-primary);
	}

	.card-id {
		font-family: inherit;
		opacity: 0.6;
	}

	.card-time {
		margin-left: auto;
	}

	.message-text {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.7;
		font-size: 1.05rem;
	}

	.status-card,
	.empty-card {
		text-align: center;
		padding: 3rem 1.5rem;
		margin: 0;
	}

	.empty-title {
		font-weight: bold;
		margin-bottom: 0.75rem;
		font-size: 1.15rem;
	}

	.empty-desc {
		opacity: 0.8;
		max-width: 500px;
		margin: 0 auto;
		line-height: 1.7;
	}

	/* Sidebar compose panel */
	.sidebar-column {
		position: sticky;
		top: 5rem;
	}

	.compose-card {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.25rem;
	}

	.compose-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.compose-header h3 {
		margin: 0;
		border: 0;
		font-size: 1.2rem;
	}

	.ttl-badge {
		font-size: 0.75rem;
		padding: 0.15rem 0.4rem;
		border: 1px solid var(--color-text-primary);
		border-radius: 2px;
		background: var(--color-primary-opacity-10);
	}

	.compose-hint {
		font-size: 0.82rem;
		margin: 0;
		opacity: 0.8;
		line-height: 1.5;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border-width: 0;
	}

	textarea {
		width: 100%;
		box-sizing: border-box;
		background-color: var(--color-bg-dark);
		color: var(--color-text-primary);
		border: 1px solid var(--color-text-primary);
		border-radius: 3px;
		padding: 0.75rem;
		font-family: inherit;
		font-size: 0.95rem;
		line-height: 1.5;
		resize: vertical;
		outline: none;
		transition: border-color 0.2s ease, box-shadow 0.2s ease;
	}

	textarea:focus {
		border-color: var(--color-text-hover);
		box-shadow: 0 0 6px var(--color-primary-opacity-30);
	}

	.compose-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.char-count {
		font-size: 0.82rem;
		opacity: 0.75;
	}

	.char-count.near-limit {
		color: var(--color-error);
		font-weight: bold;
	}

	.submit-btn {
		padding: 0.5rem 1rem;
		font-size: 0.9rem;
	}

	.compact-alert {
		margin: 0.25rem 0 0 0;
		padding: 0.5rem 0.65rem;
		font-size: 0.85rem;
	}

	@media (max-width: 900px) {
		.board-layout {
			grid-template-columns: 1fr;
		}

		.sidebar-column {
			position: static;
			order: -1;
		}

		.page-header h1 {
			font-size: 2rem;
		}
	}
</style>
