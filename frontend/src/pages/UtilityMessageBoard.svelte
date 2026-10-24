<script lang="ts">
	import { onMount } from 'svelte';
	import {
		MESSAGE_TTL_SECONDS,
		fetchActiveMessages,
		postBoardMessage,
		type BoardMessage,
	} from '../lib/messageboard/api';
	import { errorMessage } from '../lib/api';
	import PageHeader from '../lib/components/PageHeader.svelte';
	import StatusMessage from '../lib/components/StatusMessage.svelte';

	const MAX_LENGTH = 280;

	let messages = $state<BoardMessage[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	let messageText = $state('');
	let isPosting = $state(false);
	let postError = $state<string | null>(null);
	let postSuccess = $state<string | null>(null);

	async function loadMessages(): Promise<void> {
		loading = true;
		error = null;
		try {
			messages = (await fetchActiveMessages()).messages;
		} catch (err) {
			error = errorMessage(err, 'Failed to load messages.');
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
			postSuccess = `Message posted! It will remain active on the server for ~${MESSAGE_TTL_SECONDS}s.`;
			await loadMessages();
		} catch (err) {
			postError = errorMessage(err, 'Failed to post message.');
		} finally {
			isPosting = false;
		}
	}

	function formatTimestamp(isoString: string): string {
		const date = new Date(isoString);
		if (Number.isNaN(date.getTime())) {
			return isoString;
		}
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	onMount(() => {
		void loadMessages();
	});
</script>

<svelte:head>
	<title>Message Board</title>
	<meta
		name="description"
		content="Ephemeral anonymous message board where notes vanish after around {MESSAGE_TTL_SECONDS} seconds."
	/>
</svelte:head>

<PageHeader
	title="Utilities / Message Board"
	description="Post short anonymous notes to the public board. All messages are ephemeral and automatically expire after ~{MESSAGE_TTL_SECONDS} seconds on the server. Reload anytime to refresh active notes."
>
	{#snippet actions()}
		<button type="button" class="reload-btn" onclick={loadMessages} disabled={loading || isPosting}>
			{loading ? 'Refreshing...' : 'Reload Board'}
		</button>
	{/snippet}
</PageHeader>

<div class="board-layout">
	<section class="feed-column">
		<div class="feed-header">
			<h2>> Active Broadcasts ({messages.length})</h2>
			<span class="pill">[ ~{MESSAGE_TTL_SECONDS}s TTL ]</span>
		</div>

		{#if loading && messages.length === 0}
			<div class="terminal-box empty-card">
				<StatusMessage kind="loading" message="Fetching active broadcasts..." />
			</div>
		{:else if error}
			<StatusMessage kind="error" message={error} />
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
					<article class="terminal-box hover-lift message-card">
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
	</section>

	<aside class="sidebar-column">
		<form class="terminal-box compose-card" onsubmit={handlePost}>
			<div class="compose-header">
				<h3>> Post Note</h3>
				<span class="pill small">{MESSAGE_TTL_SECONDS}s TTL</span>
			</div>

			<p class="compose-hint">
				Broadcasts self-destruct after ~{MESSAGE_TTL_SECONDS}s. Only URL-safe characters are permitted.
			</p>

			<label for="board-message-input" class="sr-only">Message content</label>
			<textarea
				id="board-message-input"
				bind:value={messageText}
				placeholder="Type a note (vanishes in ~{MESSAGE_TTL_SECONDS}s)..."
				maxlength={MAX_LENGTH}
				rows="4"
				disabled={isPosting}
			></textarea>

			<div class="compose-meta">
				<span class="char-count" class:near-limit={messageText.length > MAX_LENGTH - 30}>
					{messageText.length}/{MAX_LENGTH}
				</span>
				<button type="submit" class="submit-btn" disabled={isPosting || !messageText.trim()}>
					{isPosting ? 'Posting...' : 'Post Note'}
				</button>
			</div>

			{#if postError}
				<StatusMessage kind="error" message={postError} compact />
			{/if}
			{#if postSuccess}
				<StatusMessage kind="success" message={postSuccess} compact />
			{/if}
		</form>
	</aside>
</div>

<style>
	.reload-btn {
		white-space: nowrap;
		background-color: transparent;
	}

	/* Message board as the main column, compose box to the side. */
	.board-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: 2rem;
		align-items: start;
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

	.pill {
		font-size: 0.85rem;
		padding: 0.2rem 0.55rem;
		border: 1px solid var(--color-text-primary);
		border-radius: 2px;
		background: var(--color-primary-opacity-10);
	}

	.pill.small {
		font-size: 0.75rem;
		padding: 0.15rem 0.4rem;
	}

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
		border-left-width: 3px;
		min-height: 110px;
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
	}

	.card-id {
		opacity: 0.6;
	}

	.card-time {
		margin-left: auto;
	}

	.message-text {
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.7;
		font-size: 1.05rem;
	}

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
		font-size: 1.2rem;
	}

	.compose-hint {
		font-size: 0.82rem;
		opacity: 0.8;
		line-height: 1.5;
	}

	textarea {
		width: 100%;
		padding: 0.75rem;
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

	@media (max-width: 900px) {
		.board-layout {
			grid-template-columns: 1fr;
		}

		.sidebar-column {
			position: static;
			order: -1;
		}
	}
</style>
