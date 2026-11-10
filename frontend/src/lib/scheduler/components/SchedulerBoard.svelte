<script lang="ts">
  import { addSemester } from '../schedule';
  import { formatSemester, nextMainTerm, semesterKey, upcomingMainTerm } from '../semesters';
  import type { SchedulerStore } from '../store.svelte';
  import type { PrereqEdge } from '../types';
  import SemesterColumn from './SemesterColumn.svelte';
  import SemesterPicker from './SemesterPicker.svelte';

  let { store }: { store: SchedulerStore } = $props();

  /** A prerequisite edge positioned in board coordinates. */
  type EdgeLine = Pick<PrereqEdge, 'id' | 'fromCourseId' | 'toCourseId' | 'status'> & {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };

  let boardElement = $state<HTMLDivElement>();
  // Card elements by course id, for measuring edge endpoints.
  const courseElements: Record<string, HTMLElement> = {};
  let edgeLines = $state.raw<EdgeLine[]>([]);

  const lastSemester = $derived(store.schedule.semesterOrder.at(-1));
  const nextSemesterKey = $derived(
    semesterKey(lastSemester ? nextMainTerm(lastSemester) : upcomingMainTerm(new Date())),
  );

  /** Attachment: keep `courseElements[courseId]` pointing at the card. */
  function trackCourseElement(courseId: string) {
    return (node: HTMLElement) => {
      courseElements[courseId] = node;
      return () => {
        if (courseElements[courseId] === node) {
          delete courseElements[courseId];
        }
      };
    };
  }

  function measureEdges(): void {
    if (!boardElement) {
      edgeLines = [];
      return;
    }

    const boardRect = boardElement.getBoundingClientRect();
    const lines: EdgeLine[] = [];

    for (const edge of store.graph.edges) {
      const fromRect = courseElements[edge.fromCourseId]?.getBoundingClientRect();
      const toRect = courseElements[edge.toCourseId]?.getBoundingClientRect();
      if (!fromRect || !toRect) {
        continue;
      }

      // Concurrent (same-semester) edges join card centers; others run right side -> left side.
      const isConcurrent = edge.status === 'concurrent';
      lines.push({
        id: edge.id,
        fromCourseId: edge.fromCourseId,
        toCourseId: edge.toCourseId,
        status: edge.status,
        x1: fromRect.left - boardRect.left + fromRect.width * (isConcurrent ? 0.5 : 0.75),
        y1: fromRect.top - boardRect.top + fromRect.height / 2,
        x2: toRect.left - boardRect.left + toRect.width * (isConcurrent ? 0.5 : 0.25),
        y2: toRect.top - boardRect.top + toRect.height / 2,
      });
    }

    // Draw invalid edges last so they sit on top.
    edgeLines = lines.sort(
      (a, b) => Number(a.status === 'invalid') - Number(b.status === 'invalid'),
    );
  }

  let edgeMeasureQueued = false;

  function queueEdgeMeasurement(): void {
    if (edgeMeasureQueued) {
      return;
    }

    edgeMeasureQueued = true;
    requestAnimationFrame(() => {
      edgeMeasureQueued = false;
      measureEdges();
    });
  }

  // Re-measure after anything that can move cards or change the edge set.
  $effect(() => {
    void store.graph;
    void store.schedule;
    queueEdgeMeasurement();
  });

  // Columns can change height on their own (e.g. a header switching to the term picker).
  $effect(() => {
    if (!boardElement) {
      return;
    }
    void store.columns;
    const observer = new ResizeObserver(queueEdgeMeasurement);
    observer.observe(boardElement);
    for (const column of boardElement.querySelectorAll('[data-semester-column]')) {
      observer.observe(column);
    }
    return () => observer.disconnect();
  });

  function add(key: string): void {
    store.apply((schedule) => addSemester(schedule, key), `Added ${formatSemester(key)}.`);
  }
</script>

<div class="scheduler-board" bind:this={boardElement}>
  <svg class="edge-layer" aria-hidden="true">
    {#each edgeLines as line (line.id)}
      <line
        x1={line.x1}
        y1={line.y1}
        x2={line.x2}
        y2={line.y2}
        class="edge-{line.status}"
        class:edge-highlighted={store.selectedCourseId === line.fromCourseId ||
          store.selectedCourseId === line.toCourseId}
      />
    {/each}
  </svg>

  <div class="auto-grid columns" style:--grid-min="190px">
    {#each store.columns as semester (semester)}
      <SemesterColumn {store} {semester} track={trackCourseElement} />
    {/each}

    <div class="add-column">
      <h2>{lastSemester ? 'Add semester' : 'Add first semester'}</h2>
      <SemesterPicker
        initialKey={nextSemesterKey}
        label="Add semester"
        submitLabel="Add"
        onsubmit={add}
      />
    </div>
  </div>
</div>

<style>
  .scheduler-board {
    position: relative;
    min-width: 900px;
  }

  .edge-layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    /* Above card backgrounds and progress bars, below card text (see CourseCard). */
    z-index: 1;
  }

  /* Edges are dimmed unless related to the selected course; invalid ones always stand out. */
  .edge-layer line {
    stroke-width: 2;
    opacity: 0.23;
    transition: opacity 0.2s ease;
  }

  .edge-valid {
    stroke: var(--color-success);
  }

  .edge-concurrent {
    stroke: var(--color-concurrent);
    stroke-dasharray: 8 6;
  }

  .edge-layer .edge-highlighted,
  .edge-layer .edge-invalid {
    opacity: 1;
    stroke-width: 3;
    filter: drop-shadow(0 0 4px currentColor);
  }

  .edge-layer .edge-invalid {
    stroke: var(--color-error);
    filter: drop-shadow(0 0 7px var(--color-error));
  }

  .columns {
    gap: 0.85rem;
  }

  .add-column {
    border: 1px dashed var(--color-primary-opacity-50);
    border-radius: 3px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-self: start;
  }

  .add-column h2 {
    font-size: 1rem;
    margin: 0;
    text-transform: uppercase;
  }

  @media (max-width: 1200px) {
    .scheduler-board {
      min-width: 760px;
    }
  }

  @media (max-width: 768px) {
    .scheduler-board {
      min-width: 680px;
    }
  }
</style>
