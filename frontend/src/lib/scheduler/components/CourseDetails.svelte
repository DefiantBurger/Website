<script lang="ts">
  import { buildRequirements, requirementText } from '../catalog';
  import { setCourseCredits, shiftCourse } from '../schedule';
  import { PRECOLLEGE_SEMESTER, formatSemester } from '../semesters';
  import type { SchedulerStore } from '../store.svelte';
  import type { RequirementCheck } from '../types';
  import Panel from '../../components/Panel.svelte';
  import RequirementText from './RequirementText.svelte';

  let { store }: { store: SchedulerStore } = $props();

  const course = $derived(store.selectedCourse);
  const checks = $derived(course ? (store.graph.requirementChecksByCourseId[course.id] ?? []) : []);
  // Every course this one can't count alongside, flagged when it's in the plan.
  const overlaps = $derived(
    course
      ? (store.creditOverlapIndex[course.name] ?? []).map((name) => ({
          name,
          scheduledId: store
            .overlapPartners(course.id)
            .find((id) => store.schedule.coursesById[id]?.name === name),
        }))
      : [],
  );
  // Precollege courses aren't checked, so list their raw requirements instead.
  const uncheckedRequirements = $derived(
    course?.semester === PRECOLLEGE_SEMESTER ? buildRequirements(store.catalog, course.name) : [],
  );
  const showConcurrentLegend = $derived(
    [...uncheckedRequirements, ...checks.map((check) => check.requirement)].some((requirement) =>
      requirementText(requirement.node).includes('*'),
    ),
  );

  const STATUS_LABELS: Record<RequirementCheck['status'], string> = {
    met: 'met',
    concurrent: 'concurrent',
    'out-of-order': 'too late',
    missing: 'missing',
  };

  function matchedBy(check: RequirementCheck): string {
    return check.matchedCourseIds
      .map((id) => store.schedule.coursesById[id])
      .filter(Boolean)
      .map((matched) => `${matched.name}, ${formatSemester(matched.semester)}`)
      .join('; ');
  }
</script>

<Panel compact title="Selected Course">
  {#if course}
    <p><strong>{course.name}</strong></p>
    <p>{course.title}</p>
    <div class="credits-row">
      <span>{course.credits} credits</span>
      {#if store.selectedCourseCredits.length > 1}
        <select
          value={course.credits}
          onchange={(event) =>
            store.apply((schedule) =>
              setCourseCredits(
                store.catalog,
                schedule,
                course.id,
                Number(event.currentTarget.value),
              ),
            )}
          title="Change course credits"
          aria-label="Credits for {course.name}"
        >
          {#each store.selectedCourseCredits as creditOption (creditOption)}
            <option value={creditOption}>{creditOption}</option>
          {/each}
        </select>
      {/if}
    </div>
    <p>Semester: {formatSemester(course.semester)}</p>

    <div class="move-controls">
      <button type="button" onclick={() => store.apply((s) => shiftCourse(s, course.id, -1))}>
        Move Earlier
      </button>
      <button type="button" onclick={() => store.apply((s) => shiftCourse(s, course.id, 1))}>
        Move Later
      </button>
    </div>

    <p class="key-hint">Keys: arrows move it, Delete removes it, Esc deselects.</p>

    <button type="button" class="danger" onclick={() => store.removeSelectedCourse()}
      >Remove Course</button
    >

    <h3>Requirements</h3>
    {#if uncheckedRequirements.length > 0}
      <p>Precollege credit, so these aren't checked:</p>
      <ul>
        {#each uncheckedRequirements as requirement (requirement.key)}
          <li><RequirementText node={requirement.node} /></li>
        {/each}
      </ul>
    {:else if checks.length === 0}
      <p>No catalog prerequisites.</p>
    {:else}
      <ul class="checks">
        {#each checks as check (check.requirement.key)}
          {@const by = matchedBy(check)}
          <li>
            <span class="status status-{check.status}">[{STATUS_LABELS[check.status]}]</span>
            <RequirementText node={check.requirement.node} />
            {#if by}
              <span class="satisfied-by">via {by}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if showConcurrentLegend}
      <p class="legend">* may be taken in the same semester</p>
    {/if}
    {#if overlaps.length > 0}
      <p class="overlaps">
        <span class="label">No credit with both this and:</span>
        {#each overlaps as overlap, index (overlap.name)}
          {@const scheduled = overlap.scheduledId
            ? store.schedule.coursesById[overlap.scheduledId]
            : undefined}
          {#if scheduled}<span class="in-plan"
              >{overlap.name} (in plan, {formatSemester(scheduled.semester)})</span
            >{:else}{overlap.name}{/if}{index < overlaps.length - 1 ? ', ' : ''}
        {/each}
      </p>
    {/if}
  {:else}
    <p>Select a course card to inspect details.</p>
  {/if}
</Panel>

<style>
  h3 {
    margin: 0.4rem 0 0;
    font-size: 1rem;
  }

  .credits-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
  }

  .credits-row select {
    padding: 0.3rem 0.4rem;
    cursor: pointer;
  }

  .credits-row select:hover {
    border-color: var(--color-text-primary);
  }

  .move-controls {
    display: flex;
    gap: 0.6rem;
    margin: 0.35rem 0 0.4rem;
  }

  .move-controls button {
    font-size: 0.82rem;
    padding: 0.4rem 0.7rem;
  }

  .key-hint {
    margin: 0 0 0.35rem;
    font-size: 0.8rem;
    opacity: 0.75;
  }

  /* Touch-only devices have no keyboard to use it with. */
  @media (hover: none) {
    .key-hint {
      display: none;
    }
  }

  ul {
    padding-left: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.9rem;
  }

  .checks {
    list-style: none;
    padding-left: 0;
  }

  .status {
    font-weight: bold;
  }

  .status-met {
    color: var(--color-success);
  }

  .status-concurrent {
    color: var(--color-concurrent);
  }

  .status-out-of-order,
  .status-missing {
    color: var(--color-error);
  }

  .legend,
  .overlaps {
    margin: 0.2rem 0 0;
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }

  .overlaps .label {
    font-weight: bold;
  }

  .in-plan {
    color: var(--color-warning);
  }

  .satisfied-by {
    display: block;
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }
</style>
