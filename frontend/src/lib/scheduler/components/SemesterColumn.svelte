<script lang="ts">
  import type { Attachment } from 'svelte/attachments';

  import { moveCourse, removeSemester, renameSemester } from '../schedule';
  import { PRECOLLEGE_SEMESTER, formatSemester } from '../semesters';
  import type { SchedulerStore } from '../store.svelte';
  import CourseCard from './CourseCard.svelte';
  import SemesterPicker from './SemesterPicker.svelte';

  let {
    store,
    semester,
    track,
  }: {
    store: SchedulerStore;
    semester: string;
    track: (courseId: string) => Attachment<HTMLElement>;
  } = $props();

  let editing = $state(false);

  const label = $derived(formatSemester(semester));
  const courseIds = $derived(store.schedule.columnCourseIds[semester] ?? []);
  const credits = $derived(
    courseIds.reduce((sum, id) => sum + (store.schedule.coursesById[id]?.credits ?? 0), 0),
  );
  const isPrecollege = $derived(semester === PRECOLLEGE_SEMESTER);

  // moveCourse takes a gap index, so "after the target" is the gap past it.
  function gapAt(targetCourseId: string, after: boolean): number {
    return courseIds.indexOf(targetCourseId) + Number(after);
  }

  function hover(targetCourseId: string, after: boolean): void {
    const source = store.draggedCourseId ? courseIds.indexOf(store.draggedCourseId) : -1;
    const gap = gapAt(targetCourseId, after);
    // The gaps on either side of the dragged card leave it where it is, so they get no line.
    const noOp = source >= 0 && (gap === source || gap === source + 1);
    store.dropLine = noOp ? null : { courseId: targetCourseId, after };
  }

  function drop(targetCourseId?: string, after = false): void {
    const draggedId = store.draggedCourseId;
    store.endDrag();
    if (!draggedId || draggedId === targetCourseId) {
      return;
    }
    const gap = targetCourseId ? gapAt(targetCourseId, after) : undefined;
    store.apply((schedule) => moveCourse(schedule, draggedId, semester, gap));
  }

  function remove(): void {
    const count = courseIds.length;
    if (
      count > 0 &&
      !window.confirm(
        `${label} has ${count} course${count === 1 ? '' : 's'}. Removing the semester deletes ${count === 1 ? 'it' : 'them'}. Remove ${label}?`,
      )
    ) {
      return;
    }
    store.apply((schedule) => removeSemester(schedule, semester), `Removed ${label}.`);
  }

  function rename(key: string): void {
    if (
      store.apply(
        (schedule) => renameSemester(schedule, semester, key),
        `Changed ${label} to ${formatSemester(key)}.`,
      )
    ) {
      editing = false;
    }
  }
</script>

<div
  class="semester-column"
  class:drop-target={store.dragOverSemester === semester}
  data-semester-column
  role="region"
  aria-label="Semester {label}"
  ondragovercapture={() => {
    // Cleared before the card under the pointer (if any) sets it, so empty space shows no line.
    store.dropLine = null;
  }}
  ondragover={(event) => {
    event.preventDefault();
    store.dragOverSemester = semester;
  }}
  ondragleave={() => {
    store.dropLine = null;
    if (store.dragOverSemester === semester) {
      store.dragOverSemester = null;
    }
  }}
  ondrop={(event) => {
    event.preventDefault();
    drop();
  }}
>
  <div class="semester-header">
    {#if editing}
      <SemesterPicker
        initialKey={semester}
        label="Change {label}"
        submitLabel="Save"
        onsubmit={rename}
        oncancel={() => (editing = false)}
      />
    {:else}
      <div class="title-row">
        <h2>{label}</h2>
        {#if !isPrecollege}
          <span class="header-actions">
            <button
              type="button"
              class="icon-button"
              title="Change term or year"
              aria-label="Change term or year of {label}"
              onclick={() => (editing = true)}>✎</button
            >
            <button
              type="button"
              class="icon-button danger"
              title="Remove semester"
              aria-label="Remove {label}"
              onclick={remove}>×</button
            >
          </span>
        {/if}
      </div>
    {/if}
    <span class="credits">{credits} credits</span>
  </div>

  <div class="semester-courses">
    {#each courseIds as courseId (courseId)}
      <CourseCard
        {store}
        {courseId}
        track={track(courseId)}
        ondragovercard={(after) => hover(courseId, after)}
        ondropcard={(after) => drop(courseId, after)}
      />
    {/each}
  </div>
</div>

<style>
  .semester-column {
    border: 1px solid var(--color-primary-opacity-30);
    border-radius: 3px;
    padding: 0.75rem;
    background: var(--color-primary-opacity-10);
    min-height: 100%;
  }

  .semester-column.drop-target {
    box-shadow: inset 0 0 0 2px var(--color-text-primary);
  }

  .semester-header {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 0.75rem;
    border-bottom: 1px dashed var(--color-primary-opacity-30);
    padding-bottom: 0.45rem;
  }

  .title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }

  h2 {
    font-size: 1.1rem;
    margin: 0;
    text-transform: uppercase;
  }

  .header-actions {
    display: flex;
    gap: 0.3rem;
  }

  .icon-button {
    border-width: 1px;
    padding: 0.05rem 0.4rem;
    font-size: 0.9rem;
    line-height: 1.3;
  }

  .credits {
    font-size: 0.85rem;
    opacity: 0.9;
  }

  .semester-courses {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-height: 200px;
  }
</style>
