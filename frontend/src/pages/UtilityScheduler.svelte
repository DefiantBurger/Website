<script lang="ts" module>
  import type { PageLayout } from '../lib/router.svelte';

  export const layout: PageLayout = { wide: true };
</script>

<script lang="ts">
  import { onMount } from 'svelte';

  import { errorMessage } from '../lib/api';
  import { saveBlob } from '../lib/download';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import StatusMessage from '../lib/components/StatusMessage.svelte';
  import { buildSchedule, exportSchedule } from '../lib/scheduler/catalog';
  import AddCourseForm from '../lib/scheduler/components/AddCourseForm.svelte';
  import CourseDetails from '../lib/scheduler/components/CourseDetails.svelte';
  import Panel from '../lib/scheduler/components/Panel.svelte';
  import ProblemSummary from '../lib/scheduler/components/ProblemSummary.svelte';
  import SchedulerBoard from '../lib/scheduler/components/SchedulerBoard.svelte';
  import { loadSchedulerData } from '../lib/scheduler/data';
  import { emptySchedule } from '../lib/scheduler/schedule';
  import { SchedulerStore } from '../lib/scheduler/store.svelte';
  import type { ScheduleFile } from '../lib/scheduler/types';

  const store = new SchedulerStore();

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let importInputElement = $state<HTMLInputElement>();

  function handleKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (
      loading ||
      !(event.ctrlKey || event.metaKey) ||
      target?.closest('input, select, textarea, [contenteditable]')
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      store.undo();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      store.redo();
    }
  }

  function handleClear(): void {
    const isEmpty =
      store.schedule.semesterOrder.length === 0 &&
      Object.keys(store.schedule.coursesById).length === 0;
    if (isEmpty) {
      store.notice = { kind: 'success', text: 'The plan is already empty.' };
      return;
    }
    if (
      !window.confirm(
        'Clear the whole plan? This removes every semester and course, precollege included.',
      )
    ) {
      return;
    }
    store.selectedCourseId = null;
    store.apply(() => emptySchedule(), 'Cleared the plan. Add a semester to start over.');
  }

  function handleExportJson(): void {
    saveBlob(
      new Blob([JSON.stringify(exportSchedule(store.catalog, store.schedule), null, 2)], {
        type: 'application/json',
      }),
      'schedule-export.json',
    );
    store.notice = { kind: 'success', text: 'Exported current schedule to schedule-export.json' };
  }

  async function handleImportFile(
    event: Event & { currentTarget: HTMLInputElement },
  ): Promise<void> {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    input.value = '';
    const imported = store.apply(() => {
      const parsed = JSON.parse(text) as ScheduleFile;
      if (!parsed || typeof parsed !== 'object' || !parsed.semesters) {
        throw new Error('Invalid schedule JSON format. Expected an object with a semesters field.');
      }
      return store.detangled(buildSchedule(store.catalog, parsed));
    }, `Imported schedule from ${file.name}`);
    if (imported) {
      store.selectedCourseId = null;
    }
  }

  onMount(async () => {
    try {
      const data = await loadSchedulerData();
      store.load(data.catalog, data.schedule);
    } catch (error) {
      loadError = errorMessage(error, 'Failed to load scheduler data.');
    } finally {
      loading = false;
    }
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
  <title>Scheduler · JosephCicalese.com</title>
  <meta
    name="description"
    content="Interactive course scheduler with prerequisite validation and dependency visualization."
  />
</svelte:head>

<PageHeader title="Utilities / Class Scheduler">
  <p>
    Drag courses between semesters and inspect prerequisite health in real time. The default
    schedule is my own. Course data may not be fully accurate; please report any issues <a
      href="/contact">here</a
    >.
  </p>
</PageHeader>

{#if loading}
  <StatusMessage kind="loading" message="Loading scheduler..." />
{:else if loadError}
  <StatusMessage kind="error" message={loadError} />
{:else}
  <div class="scheduler-layout">
    <section class="terminal-box scheduler-board-wrap">
      <SchedulerBoard {store} />
    </section>

    <aside class="terminal-box details">
      <CourseDetails {store} />
      <ProblemSummary {store} />
      <AddCourseForm {store} />

      <div class="scheduler-controls">
        <div class="history-actions">
          <button
            type="button"
            onclick={() => store.undo()}
            disabled={!store.canUndo}
            title="Undo (Ctrl+Z)">Undo</button
          >
          <button
            type="button"
            onclick={() => store.redo()}
            disabled={!store.canRedo}
            title="Redo (Ctrl+Shift+Z)">Redo</button
          >
        </div>
        <button type="button" onclick={() => store.apply((schedule) => store.detangled(schedule))}
          >Auto-detangle lines</button
        >
        <button type="button" class="danger" onclick={handleClear}>Clear All</button>
      </div>

      <Panel title="Import / Export">
        <div class="io-actions">
          <button type="button" onclick={() => importInputElement?.click()}>Import JSON</button>
          <button type="button" onclick={handleExportJson}>Export JSON</button>
          <input
            bind:this={importInputElement}
            type="file"
            accept="application/json"
            hidden
            onchange={handleImportFile}
          />
        </div>
      </Panel>

      {#if store.notice}
        <StatusMessage kind={store.notice.kind} message={store.notice.text} compact />
      {/if}
    </aside>
  </div>
{/if}

<style>
  .scheduler-layout {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 1.25rem;
  }

  .scheduler-board-wrap {
    overflow: auto;
    position: relative;
    min-height: 60vh;
  }

  .details {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .scheduler-controls {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .scheduler-controls button {
    width: 100%;
    font-size: 0.86rem;
    padding: 0.55rem 0.8rem;
  }

  .scheduler-controls button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    box-shadow: none;
  }

  .history-actions,
  .io-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  @media (max-width: 1200px) {
    .scheduler-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 768px) {
    .scheduler-board-wrap {
      padding: 0.65rem;
    }
  }
</style>
