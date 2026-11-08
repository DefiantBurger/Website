<script lang="ts">
  import { formatSemester } from '../semesters';
  import type { SchedulerStore } from '../store.svelte';
  import Panel from './Panel.svelte';

  let { store }: { store: SchedulerStore } = $props();
</script>

<Panel title="Problems ({store.problems.length})">
  {#if store.problems.length === 0}
    <p class="ok">No prerequisite problems.</p>
  {:else}
    <ul>
      {#each store.problems as problem (problem.courseId)}
        {@const course = store.schedule.coursesById[problem.courseId]}
        <li>
          <button
            type="button"
            class="problem"
            class:selected={store.selectedCourseId === problem.courseId}
            onclick={() => store.reveal(problem.courseId)}
          >
            <strong>{course.name}</strong>
            <span class="semester">{formatSemester(course.semester)}</span>
            {#each problem.checks as check (check.requirement.courseChoices.join('|'))}
              <span class="detail">
                {check.requirement.courseChoices.join(' OR ')}
                {check.status === 'missing' ? 'missing' : 'too late'}
              </span>
            {/each}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</Panel>

<style>
  .ok {
    color: var(--color-success);
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    max-height: 18rem;
    overflow-y: auto;
  }

  .problem {
    width: 100%;
    text-align: left;
    border: 1px solid var(--color-error);
    padding: 0.4rem 0.55rem;
    font-size: 0.85rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem 0.5rem;
  }

  .problem.selected {
    box-shadow: 0 0 0 1px var(--color-text-primary);
  }

  .semester {
    color: var(--color-text-muted);
  }

  .detail {
    width: 100%;
    color: var(--color-error);
  }
</style>
