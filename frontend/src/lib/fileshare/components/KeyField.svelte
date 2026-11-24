<script lang="ts">
  import type { Snippet } from 'svelte';
  import CopyButton from './CopyButton.svelte';

  let {
    id,
    value = $bindable(''),
    label = 'Access key',
    placeholder = 'Access key',
    generated = null,
    children,
  }: {
    id: string;
    value?: string;
    label?: string;
    placeholder?: string;
    /** A generated key to show in full, since six words overflow the field on phones. */
    generated?: string | null;
    /** Buttons beside the field. */
    children?: Snippet;
  } = $props();
</script>

<!-- Labelled by id rather than wrapped, so button text stays out of the input's name. -->
<div class="key-field">
  <label for={id}>{label}</label>
  <div class="key-row">
    <input
      {id}
      type="text"
      bind:value
      {placeholder}
      maxlength="128"
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
    />
    {@render children?.()}
  </div>
  {#if generated}
    <p class="generated">
      <span>Share this key: <strong>{generated}</strong></span>
      <CopyButton text={generated} />
    </p>
  {/if}
</div>

<style>
  .key-field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .key-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  input {
    flex: 1 1 14rem;
    min-width: 0;
    padding: 0.85rem 0.9rem;
  }

  .generated {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    line-height: 1.5;
    font-size: 0.9rem;
    color: var(--color-text-muted);
  }

  .generated strong {
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }
</style>
