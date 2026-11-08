<script lang="ts">
  import {
    MAX_YEAR,
    MIN_YEAR,
    TERMS,
    formatTerm,
    parseSemesterKey,
    semesterKey,
    type TermParts,
  } from '../semesters';

  let {
    initialKey,
    label,
    submitLabel,
    onsubmit,
    oncancel,
  }: {
    // Term key the fields start at; they reset whenever it changes.
    initialKey: string;
    label: string;
    submitLabel: string;
    onsubmit: (key: string) => void;
    oncancel?: () => void;
  } = $props();

  const initial = $derived<TermParts>(
    parseSemesterKey(initialKey) ?? { term: 'fall', year: MIN_YEAR },
  );
  let term = $derived(initial.term);
  let year = $derived(initial.year);

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    // The number input's min/max/required already block bad years.
    if (Number.isInteger(year)) {
      onsubmit(semesterKey({ term, year }));
    }
  }
</script>

<form class="semester-picker" aria-label={label} onsubmit={submit}>
  <select bind:value={term} aria-label="Term">
    {#each TERMS as option (option)}
      <option value={option}>{formatTerm(option)}</option>
    {/each}
  </select>
  <input type="number" bind:value={year} min={MIN_YEAR} max={MAX_YEAR} required aria-label="Year" />
  <div class="actions">
    <button type="submit">{submitLabel}</button>
    {#if oncancel}
      <button type="button" onclick={oncancel}>Cancel</button>
    {/if}
  </div>
</form>

<style>
  .semester-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  select,
  input {
    border-color: var(--color-text-muted);
    padding: 0.3rem 0.4rem;
    font-size: 0.85rem;
  }

  select {
    flex: 1 1 5.5rem;
  }

  input {
    flex: 1 1 4.5rem;
    min-width: 0;
  }

  .actions {
    display: flex;
    gap: 0.4rem;
    width: 100%;
  }

  button {
    flex: 1;
    font-size: 0.82rem;
    padding: 0.35rem 0.6rem;
  }
</style>
