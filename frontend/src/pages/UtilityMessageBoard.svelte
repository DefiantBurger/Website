<script lang="ts" module>
  import type { PageLayout } from '../lib/router.svelte';

  export const layout: PageLayout = { wide: true };
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchActiveMessages, postBoardMessage, type BoardLimits } from '../lib/messageboard/api';
  import {
    messageLength,
    secondsLeft,
    withLocalExpiry,
    type LiveMessage,
  } from '../lib/messageboard/board';
  import { AsyncTask } from '../lib/asyncTask.svelte';
  import { formatTime } from '../lib/format';
  import FormMessages from '../lib/components/FormMessages.svelte';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import { routeDefinitions } from '../lib/routeDefinitions';
  import StatusMessage from '../lib/components/StatusMessage.svelte';

  const POLL_INTERVAL_MS = 5000;
  // The countdown turns red this close to expiry.
  const EXPIRING_SECONDS = 10;

  // TTL and length limit come from the backend; null until loaded (the server enforces both).
  let limits = $state<BoardLimits | null>(null);
  const ttl = $derived(limits ? `~${limits.retentionSeconds}s` : null);
  const maxLength = $derived(limits?.maxMessageLength);

  let messages = $state<LiveMessage[]>([]);
  // Ticks every second, so cards count down and drop off as they expire.
  let now = $state(Date.now());
  const activeMessages = $derived(messages.filter((message) => secondsLeft(message, now) > 0));
  const feed = new AsyncTask('Failed to load messages.', { busy: true });

  let messageText = $state('');
  const length = $derived(messageLength(messageText));
  const post = new AsyncTask('Failed to post message.');

  async function fetchBoard(): Promise<void> {
    const { messages: fetched, serverTime, ...boardLimits } = await fetchActiveMessages();
    messages = withLocalExpiry(fetched, serverTime, Date.now());
    limits = boardLimits;
  }

  /** Quiet refresh for polling and after posting: a failure keeps the current board, which still expires locally. */
  async function refresh(): Promise<void> {
    if (feed.busy || document.hidden) {
      return;
    }
    try {
      await fetchBoard();
      // Recovers from a failed first load.
      feed.error = null;
    } catch {
      // The next poll tries again.
    }
  }

  async function handlePost(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    const trimmed = messageText.trim();
    if (!trimmed) {
      post.fail('Please enter a message to broadcast.');
      return;
    }

    // No `maxlength` on the textarea: it counts UTF-16 units, so emoji would count twice.
    if (maxLength !== undefined && length > maxLength) {
      post.fail(`Message exceeds ${maxLength} characters.`);
      return;
    }

    const posted = await post.run(async () => {
      await postBoardMessage(trimmed);
      messageText = '';
      post.success = ttl
        ? `Message posted! It will remain active on the server for ${ttl}.`
        : 'Message posted!';
    });
    if (posted) {
      await refresh();
    }
  }

  onMount(() => {
    void feed.run(fetchBoard);
    const clock = setInterval(() => (now = Date.now()), 1000);
    const poller = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      clearInterval(clock);
      clearInterval(poller);
    };
  });
</script>

<!-- Polling pauses in background tabs, so catch up as soon as the tab is shown again. -->
<svelte:document onvisibilitychange={refresh} />

<PageHeader
  title="Utilities / {routeDefinitions.messageBoard.meta.title}"
  description="Post short anonymous notes to the public board. All messages are ephemeral and expire shortly after posting. The board updates on its own every few seconds."
/>

<div class="board-layout">
  <section class="feed-column">
    <div class="feed-header">
      <h2 class="prompt">Active Broadcasts ({activeMessages.length})</h2>
      {#if ttl}
        <span class="pill">[ {ttl} TTL ]</span>
      {/if}
    </div>

    {#if feed.busy}
      <div class="terminal-box empty-card">
        <StatusMessage kind="loading" message="Fetching active broadcasts..." />
      </div>
    {:else if feed.error}
      <StatusMessage kind="error" message={feed.error} />
    {:else if activeMessages.length === 0}
      <div class="terminal-box empty-card">
        <p class="empty-title">[ NO ACTIVE BROADCASTS ]</p>
        <p class="empty-desc">
          The board is clear right now. Post a note with the compose box and it shows up here until
          it expires.
        </p>
      </div>
    {:else}
      <div class="auto-grid message-grid" style:--grid-min="320px" style:--grid-repeat="auto-fill">
        {#each activeMessages as msg (msg.id)}
          {@const left = secondsLeft(msg, now)}
          <article class="terminal-box hover-lift message-card">
            <header class="card-meta">
              <span class="prompt-icon" aria-hidden="true">></span>
              <span class="card-id">#{msg.id.slice(0, 6)}</span>
              <span class="card-time">{formatTime(msg.createdAt)}</span>
              <span class="card-ttl" class:expiring={left <= EXPIRING_SECONDS}>{left}s left</span>
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
        <h3 class="prompt">Post Note</h3>
        {#if ttl}
          <span class="pill small">{ttl} TTL</span>
        {/if}
      </div>

      <p class="compose-hint">
        Broadcasts self-destruct {ttl ? `after ${ttl}` : 'shortly after posting'}. Plain text only;
        invisible and control characters are removed.
      </p>

      <label for="board-message-input" class="sr-only">Message content</label>
      <textarea
        id="board-message-input"
        bind:value={messageText}
        placeholder={ttl ? `Type a note (vanishes in ${ttl})...` : 'Type a note...'}
        rows="4"
        disabled={post.busy}></textarea>

      <div class="compose-meta">
        <span
          class="char-count"
          class:near-limit={maxLength !== undefined && length > maxLength - 30}
        >
          {length}{maxLength !== undefined ? `/${maxLength}` : ''}
        </span>
        <button type="submit" class="submit-btn" disabled={post.busy || !messageText.trim()}>
          {post.busy ? 'Posting...' : 'Post Note'}
        </button>
      </div>

      <FormMessages error={post.error} success={post.success} />
    </form>
  </aside>
</div>

<style>
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
    gap: 0.75rem;
    border-bottom: 1px solid var(--color-text-primary);
    padding-bottom: 0.5rem;
    margin-bottom: 1.25rem;
  }

  .feed-header h2 {
    margin: 0;
    font-size: 1.4rem;
  }

  .pill {
    font-size: 0.85rem;
    padding: 0.2rem 0.55rem;
    border: 1px solid var(--color-text-primary);
    border-radius: 2px;
    background: var(--color-primary-opacity-10);
    white-space: nowrap;
  }

  .pill.small {
    font-size: 0.75rem;
    padding: 0.15rem 0.4rem;
  }

  .message-grid {
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
    color: var(--color-text-muted);
    border-bottom: var(--divider);
    padding-bottom: 0.35rem;
  }

  .prompt-icon {
    font-weight: bold;
  }

  .card-time {
    margin-left: auto;
  }

  /* Fixed width so the header doesn't shift as the countdown loses a digit. */
  .card-ttl {
    min-width: 7ch;
    text-align: right;
  }

  .card-ttl.expiring {
    color: var(--color-error);
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
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease;
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
    color: var(--color-text-muted);
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
