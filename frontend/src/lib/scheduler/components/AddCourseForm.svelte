<script lang="ts">
  import { resolveCourseQuery, searchCatalog } from '../catalog';
  import { addCourse } from '../schedule';
  import { formatSemester } from '../semesters';
  import type { SchedulerStore } from '../store.svelte';
  import Panel from '../../components/Panel.svelte';

  let { store }: { store: SchedulerStore } = $props();

  let query = $state('');
  // Falls back to the first term (or precollege) when the chosen column is removed.
  let pickedSemester = $state('');
  const targetSemester = $derived(
    store.columns.includes(pickedSemester)
      ? pickedSemester
      : (store.schedule.semesterOrder[0] ?? store.columns[0]),
  );

  const suggestions = $derived(searchCatalog(store.catalog, query));

  function add(): void {
    const courseName = resolveCourseQuery(store.catalog, query, suggestions);
    if (!courseName) {
      store.fail('Pick a course from the search results before adding.');
      return;
    }

    const semester = targetSemester;
    let addedId: string | null = null;
    const added = store.apply(
      (schedule) => {
        const result = addCourse(store.catalog, schedule, courseName, semester);
        addedId = result.course.id;
        return result.schedule;
      },
      `Added ${courseName} to ${formatSemester(semester)}.`,
    );

    if (added) {
      store.selectedCourseId = addedId;
      query = courseName;
    }
  }
</script>

<Panel compact title="Add Class">
  <input
    type="text"
    aria-label="Course to add"
    placeholder="Search by course code or title"
    bind:value={query}
    list="course-catalog-options"
  />
  <datalist id="course-catalog-options">
    {#each suggestions.flatMap((item) => item.labels) as label (label)}
      <option value={label} {label}></option>
    {/each}
  </datalist>

  <select
    value={targetSemester}
    onchange={(event) => (pickedSemester = event.currentTarget.value)}
    aria-label="Semester to add the course to"
  >
    {#each store.columns as semester (semester)}
      <option value={semester}>{formatSemester(semester)}</option>
    {/each}
  </select>

  <button type="button" onclick={add}>Add</button>
</Panel>
