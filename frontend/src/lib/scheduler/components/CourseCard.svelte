<script lang="ts">
  import type { Attachment } from 'svelte/attachments';

  import type { SchedulerStore } from '../store.svelte';

  let {
    store,
    courseId,
    track,
    ondragovercard,
    ondropcard,
  }: {
    store: SchedulerStore;
    courseId: string;
    // Registers the card element so the board can measure edge endpoints.
    track: Attachment<HTMLElement>;
    // `after` is true when the pointer is over the card's lower half.
    ondragovercard: (after: boolean) => void;
    ondropcard: (after: boolean) => void;
  } = $props();

  const course = $derived(store.schedule.coursesById[courseId]);
  const progress = $derived(store.progressPercent(courseId));
  const repeat = $derived(store.repeats[courseId]);
  const overlapNames = $derived(
    store
      .overlapPartners(courseId)
      .map((id) => store.schedule.coursesById[id]?.name)
      .join(', '),
  );
  const selected = $derived(store.selectedCourseId === courseId);

  let element = $state<HTMLButtonElement>();
  const dropLine = $derived(store.dropLine?.courseId === courseId ? store.dropLine : null);

  function isLowerHalf(event: DragEvent & { currentTarget: HTMLElement }): boolean {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  }

  function select(): void {
    store.selectedCourseId = courseId;
  }

  $effect(() => {
    const request = store.revealRequest;
    if (element && request?.courseId === courseId) {
      // JS scrolling ignores the CSS reduced-motion rule, so check it here.
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      element.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        // Centering on every arrow press would make the board jump around.
        block: request.fromKeyboard ? 'nearest' : 'center',
        inline: 'nearest',
      });
      if (request.fromKeyboard) {
        // A move re-creates or re-inserts the card, which drops focus to the page.
        element.focus({ preventScroll: true });
      }
      store.revealRequest = null;
    }
  });
</script>

<button
  type="button"
  bind:this={element}
  {@attach track}
  class="course-card"
  class:selected
  aria-pressed={selected}
  draggable="true"
  onpointerdown={select}
  onfocus={select}
  onclick={select}
  ondragstart={() => {
    select();
    store.draggedCourseId = courseId;
  }}
  ondragend={() => store.endDrag()}
  class:drop-before={dropLine && !dropLine.after}
  class:drop-after={dropLine?.after}
  ondragover={(event) => {
    event.preventDefault();
    ondragovercard(isLowerHalf(event));
  }}
  ondrop={(event) => {
    event.preventDefault();
    event.stopPropagation();
    ondropcard(isLowerHalf(event));
  }}
>
  <!-- Spans, not a heading: buttons may only contain phrasing content. -->
  <span class="course-header">
    <span class="course-name">{course.name}</span>
    <span class="course-meta">
      {#if repeat}
        <span
          class="repeat-icon"
          aria-hidden="true"
          title="Repeated ({repeat.position} of {repeat.total})">↻</span
        >
        <span class="sr-only">, repeated, {repeat.position} of {repeat.total},</span>
      {/if}
      {#if overlapNames}
        <span class="overlap-icon" aria-hidden="true" title="No credit with both: {overlapNames}"
          >≠</span
        >
        <span class="sr-only">, no credit with both this and {overlapNames},</span>
      {/if}
      <span class="course-credits">{course.credits}cr</span>
    </span>
  </span>

  {#if progress !== null}
    <span class="sr-only">, prerequisites {progress}% met</span>
    <span class="progress-wrap" aria-hidden="true">
      <span class="progress-fill" style:width="{progress}%"></span>
    </span>
  {/if}
</button>

<style>
  .course-card {
    background: var(--color-primary-opacity-15);
    border: 1px solid var(--color-primary-opacity-30);
    border-radius: 3px;
    padding: 0.6rem;
    cursor: grab;
    user-select: none;
    text-align: left;
    width: 100%;
    /* Anchors the drop line; no z-index, so it stays out of the stacking-context problem below. */
    position: relative;
  }

  /* Insertion line, centered in the 0.6rem column gap (offsets include the 1px border). */
  .course-card.drop-before::before,
  .course-card.drop-after::after {
    content: '';
    position: absolute;
    left: -1px;
    right: -1px;
    height: 2px;
    background: var(--color-text-primary);
    box-shadow: 0 0 4px var(--color-text-primary);
    pointer-events: none;
    z-index: 3;
  }

  .course-card.drop-before::before {
    top: calc(-0.3rem - 2px);
  }

  .course-card.drop-after::after {
    bottom: calc(-0.3rem - 2px);
  }

  /* No press-scale: a transform would make the card its own stacking context and put the edge lines over its text. */
  .course-card:active {
    transform: none;
    cursor: grabbing;
  }

  .course-card.selected {
    box-shadow: 0 0 0 2px var(--color-text-primary);
    background: var(--color-primary-opacity-30);
  }

  .course-header {
    display: flex;
    position: relative;
    z-index: 2;
    justify-content: space-between;
    gap: 0.5rem;
    align-items: baseline;
  }

  /* Was an h3; keep the global heading look. */
  .course-name {
    font-size: 0.95rem;
    font-weight: bold;
    line-height: 1.35;
    text-shadow: 0 0 2px var(--color-primary-opacity-30);
  }

  .course-meta {
    display: flex;
    gap: 0.3rem;
    align-items: baseline;
    white-space: nowrap;
  }

  .course-credits {
    font-size: 0.8rem;
    opacity: 0.85;
  }

  .repeat-icon {
    font-size: 0.85rem;
    color: var(--color-accent);
  }

  .overlap-icon {
    font-size: 0.85rem;
    font-weight: bold;
    color: var(--color-warning);
  }

  .progress-wrap {
    display: block;
    height: 6px;
    width: 100%;
    background: var(--color-error-opacity-05);
    border: 1px solid var(--color-primary-opacity-30);
    margin-top: 0.55rem;
  }

  .progress-fill {
    display: block;
    height: 100%;
    background: var(--color-success);
  }
</style>
