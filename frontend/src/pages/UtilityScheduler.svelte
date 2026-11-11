<script lang="ts" module>
  import type { PageLayout } from '../lib/router.svelte';

  export const layout: PageLayout = { wide: true };
</script>

<script lang="ts">
  import { onMount } from 'svelte';

  import { errorMessage } from '../lib/api';
  import { AsyncTask } from '../lib/asyncTask.svelte';
  import { saveBlob } from '../lib/download';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import { pathFor, routeDefinitions } from '../lib/routeDefinitions';
  import StatusMessage from '../lib/components/StatusMessage.svelte';
  import { buildSchedule, exportSchedule, parseScheduleFile } from '../lib/scheduler/catalog';
  import AddCourseForm from '../lib/scheduler/components/AddCourseForm.svelte';
  import CourseDetails from '../lib/scheduler/components/CourseDetails.svelte';
  import Panel from '../lib/components/Panel.svelte';
  import ProblemSummary from '../lib/scheduler/components/ProblemSummary.svelte';
  import SchedulerBoard from '../lib/scheduler/components/SchedulerBoard.svelte';
  import { loadSchedulerData } from '../lib/scheduler/data';
  import { emptySchedule, nudgeCourse, shiftCourse } from '../lib/scheduler/schedule';
  import { decodePlan, encodePlan, planFromHash, planHash } from '../lib/scheduler/shareLink';
  import { SchedulerStore } from '../lib/scheduler/store.svelte';
  import type { ScheduleFile, ScheduleState } from '../lib/scheduler/types';

  const URL_WRITE_DELAY_MS = 300;

  const store = new SchedulerStore();

  // Starts busy so the URL-sync effect doesn't save the empty pre-load plan.
  const load = new AsyncTask('Failed to load scheduler data.', { busy: true });
  let importInputElement = $state<HTMLInputElement>();

  // Plain (non-reactive) bookkeeping for keeping the URL in sync with the plan.
  let defaultSchedule: ScheduleState | null = null;
  // The URL stays bare until the plan first differs from what was loaded.
  let loadedSchedule: ScheduleState | null = null;
  let urlSyncStarted = false;
  // Encoding is async; only the newest write may land.
  let urlWriteId = 0;

  // The fragment holds the plan, so it doubles as autosave (reload, Back, reopened tabs).
  $effect(() => {
    const schedule = store.schedule;
    if (load.busy || (!urlSyncStarted && schedule === loadedSchedule)) {
      return;
    }
    urlSyncStarted = true;
    const writeId = ++urlWriteId;
    const timer = setTimeout(async () => {
      try {
        const encoded = await encodePlan(exportSchedule(store.catalog, schedule));
        if (writeId === urlWriteId) {
          writePlanToUrl(encoded);
        }
      } catch {
        // No CompressionStream (very old browser): the plan just isn't saved in the URL.
      }
    }, URL_WRITE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      urlWriteId++;
    };
  });

  function writePlanToUrl(encoded: string): void {
    const { pathname, search } = window.location;
    window.history.replaceState(
      window.history.state,
      '',
      `${pathname}${search}${planHash(encoded)}`,
    );
  }

  function skippedNote(skipped: string[]): string {
    const noun = skipped.length === 1 ? 'course' : 'courses';
    return ` Skipped ${skipped.length} unknown or invalid ${noun}: ${skipped.join(', ')}.`;
  }

  /** Replace the plan with one read from a link or file. `asUndoStep: false` replaces the history instead (initial load). */
  async function importPlan(
    read: () => Promise<ScheduleFile>,
    {
      success,
      failure = (reason) => reason,
      detangle = false,
      asUndoStep = true,
    }: {
      success: string;
      failure?: (reason: string) => string;
      detangle?: boolean;
      asUndoStep?: boolean;
    },
  ): Promise<void> {
    const skipped: string[] = [];
    let schedule: ScheduleState;
    try {
      schedule = buildSchedule(store.catalog, await read(), skipped);
    } catch (error) {
      store.fail(failure(errorMessage(error, 'Could not load that plan.')));
      return;
    }
    if (detangle) {
      schedule = store.detangled(schedule);
    }
    if (asUndoStep) {
      if (!store.apply(() => schedule, success)) {
        return;
      }
      store.selectedCourseId = null;
    } else {
      store.load(store.catalog, schedule, false);
    }
    if (skipped.length > 0) {
      store.fail(success + skippedNote(skipped));
    }
  }

  // Pasting another plan link into the same tab changes only the fragment, so nothing reloads.
  async function handleHashChange(): Promise<void> {
    const encoded = planFromHash(window.location.hash);
    if (load.busy || load.error || !encoded) {
      return;
    }
    await importPlan(() => decodePlan(encoded), { success: 'Loaded the plan from the link.' });
  }

  async function handleCopyLink(): Promise<void> {
    try {
      writePlanToUrl(await encodePlan(exportSchedule(store.catalog, store.schedule)));
    } catch {
      store.fail('This browser cannot create plan links.');
      return;
    }
    try {
      await navigator.clipboard.writeText(window.location.href);
      store.succeed('Copied a link to this plan.');
    } catch {
      store.fail('Could not copy the link. The address bar has it; copy it from there.');
    }
  }

  function handleReset(): void {
    const schedule = defaultSchedule;
    if (!schedule) {
      return;
    }
    store.selectedCourseId = null;
    store.apply(
      () => store.detangled(schedule),
      'Reset to the default plan. Undo brings yours back.',
    );
  }

  // Arrows move the selected course, not the selection; they scroll the page only when nothing is selected.
  const COURSE_KEYS: Record<string, (schedule: ScheduleState, courseId: string) => ScheduleState> =
    {
      ArrowUp: (schedule, courseId) => nudgeCourse(schedule, courseId, -1),
      ArrowDown: (schedule, courseId) => nudgeCourse(schedule, courseId, 1),
      ArrowLeft: (schedule, courseId) => shiftCourse(schedule, courseId, -1),
      ArrowRight: (schedule, courseId) => shiftCourse(schedule, courseId, 1),
    };

  function handleKeydown(event: KeyboardEvent): void {
    if (load.busy || load.error) {
      return;
    }
    const key = event.key.toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;

    // Before the text-field check: the browser's own Ctrl+S (save page) is never wanted here.
    if (modifier && key === 's' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      void handleCopyLink();
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('input, select, textarea, [contenteditable]')) {
      return;
    }

    if (modifier) {
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        store.undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        store.redo();
      }
      return;
    }

    const course = store.selectedCourse;
    if (!course || event.altKey || event.shiftKey) {
      return;
    }
    const move = COURSE_KEYS[event.key];
    if (move) {
      event.preventDefault();
      store.apply((schedule) => move(schedule, course.id));
      store.reveal(course.id, true);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      store.removeSelectedCourse();
    } else if (event.key === 'Escape') {
      store.selectedCourseId = null;
    }
  }

  function handleClear(): void {
    const isEmpty =
      store.schedule.semesterOrder.length === 0 &&
      Object.keys(store.schedule.coursesById).length === 0;
    if (isEmpty) {
      store.succeed('The plan is already empty.');
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
    store.succeed('Exported current schedule to schedule-export.json');
  }

  async function handleImportFile(
    event: Event & { currentTarget: HTMLInputElement },
  ): Promise<void> {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    // Cleared before any await so picking the same file again always fires `change`.
    input.value = '';
    await importPlan(async () => parseScheduleFile(JSON.parse(await file.text())), {
      success: `Imported schedule from ${file.name}.`,
      detangle: true,
    });
  }

  onMount(() => {
    void load.run(async () => {
      const data = await loadSchedulerData();
      defaultSchedule = data.schedule;
      store.load(data.catalog, data.schedule);

      const encoded = planFromHash(window.location.hash);
      if (encoded) {
        await importPlan(() => decodePlan(encoded), {
          success: 'Loaded the shared plan.',
          failure: (reason) => `${reason} Showing the default plan instead.`,
          asUndoStep: false,
        });
      }
      loadedSchedule = store.schedule;
    });
  });
</script>

<svelte:window onkeydown={handleKeydown} onhashchange={handleHashChange} />

<PageHeader title="Utilities / {routeDefinitions.scheduler.meta.title}">
  <p>
    Drag courses between semesters and inspect prerequisite health in real time. The default
    schedule is my own. Course data may not be fully accurate; please report any issues <a
      href={pathFor('contact')}>here</a
    >.
  </p>
</PageHeader>

{#if load.busy}
  <StatusMessage kind="loading" message="Loading scheduler..." />
{:else if load.error}
  <StatusMessage kind="error" message={load.error} />
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
            title="Undo (Ctrl+Z)"
            aria-keyshortcuts="Control+Z">Undo</button
          >
          <button
            type="button"
            onclick={() => store.redo()}
            disabled={!store.canRedo}
            title="Redo (Ctrl+Shift+Z)"
            aria-keyshortcuts="Control+Shift+Z Control+Y">Redo</button
          >
        </div>
        <button type="button" onclick={() => store.apply((schedule) => store.detangled(schedule))}
          >Auto-detangle lines</button
        >
        <button type="button" onclick={handleReset}>Reset to default plan</button>
        <button type="button" class="danger" onclick={handleClear}>Clear All</button>
      </div>

      <Panel compact title="Save / Share">
        <p>The page URL holds your plan and updates as you edit. Bookmark it or share it.</p>
        <button
          type="button"
          class="copy-link"
          onclick={handleCopyLink}
          title="Copy link (Ctrl+S)"
          aria-keyshortcuts="Control+S">Copy link to plan</button
        >
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

  .copy-link {
    width: 100%;
  }

  .history-actions,
  .io-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  @media (max-width: 1200px) {
    .scheduler-layout {
      /* minmax(0, …): a bare 1fr can't shrink below its content's min width. */
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 768px) {
    .scheduler-board-wrap {
      padding: 0.65rem;
    }
  }
</style>
