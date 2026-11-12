<script lang="ts">
  import { shell } from '../shell/shell.svelte';

  let input = $state('');
  // Position in shell.history while using the arrow keys; `draft` holds what was being typed.
  let historyIndex = 0;
  let draft = '';

  function isTextField(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      target.closest('input, select, textarea, [contenteditable]') !== null
    );
  }

  /** `/` and backtick open the shell from anywhere that isn't a text field. */
  function handleWindowKeydown(event: KeyboardEvent) {
    if (shell.isOpen || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if ((event.key === '/' || event.key === '`') && !isTextField(event.target)) {
      // Also keeps the key out of the input and stops Firefox's quick find.
      event.preventDefault();
      shell.open();
    }
  }

  function handleInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      shell.close();
    } else if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      input = shell.complete(input);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      recall(event.key === 'ArrowUp' ? -1 : 1);
    }
  }

  function recall(step: number) {
    const next = Math.min(Math.max(historyIndex + step, 0), shell.history.length);
    if (next === historyIndex) {
      return;
    }
    if (historyIndex === shell.history.length) {
      draft = input;
    }
    historyIndex = next;
    input = shell.history[next] ?? draft;
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    // Not awaited: the store appends the output when the command finishes.
    void shell.submit(input);
    input = '';
    historyIndex = shell.history.length;
  }

  /** Attachment: keep the newest line in view. Reads lines.length so it re-runs per command. */
  function followOutput(log: HTMLElement) {
    void shell.lines.length;
    log.scrollTop = log.scrollHeight;
  }

  /** Attachment: the input mounts on every open, so this focuses it each time. */
  function focusOnMount(node: HTMLElement) {
    node.focus();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if shell.isOpen}
  <section class="shell" aria-label="Shell">
    <!-- The log scrolls, so keyboard users need to be able to focus it. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="log" role="log" aria-label="Shell output" tabindex="0" {@attach followOutput}>
      {#each shell.lines as line, index (index)}
        <div class:prompt={line.kind === 'input'} class:error={line.kind === 'error'}>
          {line.text}
        </div>
      {/each}
    </div>
    <form class="prompt" onsubmit={submit}>
      <label for="shell-input" class="sr-only">Command</label>
      <input
        id="shell-input"
        bind:value={input}
        onkeydown={handleInputKeydown}
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="go"
        {@attach focusOnMount}
      />
    </form>
  </section>
{/if}

<style>
  .shell {
    position: fixed;
    inset: auto 0 0 0;
    height: var(--shell-height);
    z-index: 150; /* above the sticky nav (100), below the skip link (200) */
    display: flex;
    flex-direction: column;
    background: var(--color-bg-surface);
    border-top: 2px solid var(--color-text-primary);
    box-shadow: 0 -6px 12px var(--color-primary-opacity-10);
    font-size: 0.9rem;
  }

  .log {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 1rem;
    white-space: pre-wrap;
  }

  .error {
    color: var(--color-error);
  }

  form {
    display: flex;
    align-items: center;
    /* The prompt's trailing space collapses inside a flex row. */
    gap: 0.5ch;
    padding: 0.5rem 1rem;
    border-top: var(--divider);
  }

  input {
    flex: 1;
    min-width: 0;
    border: 0;
    padding: 0.2rem 0.5ch;
    background: transparent;
    outline-offset: 0;
  }
</style>
