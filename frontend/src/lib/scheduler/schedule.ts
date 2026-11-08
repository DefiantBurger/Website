// Schedule edits as pure functions: each returns a new ScheduleState and leaves its input alone,
// so the page can keep every version for undo. Invalid edits throw with a user-facing message.
import { createCourse, getValidCredits } from './catalog';
import { PRECOLLEGE_SEMESTER, formatSemester, isSemesterKey, sortSemesters } from './semesters';
import type { CourseCatalog, CourseInstance, ScheduleState } from './types';

export function emptySchedule(): ScheduleState {
  return { semesterOrder: [], coursesById: {}, columnCourseIds: { [PRECOLLEGE_SEMESTER]: [] } };
}

/** Every column left to right: precollege, then each term. */
export function boardColumns(schedule: ScheduleState): string[] {
  return [PRECOLLEGE_SEMESTER, ...schedule.semesterOrder];
}

function hasColumn(schedule: ScheduleState, semester: string): boolean {
  return semester === PRECOLLEGE_SEMESTER || schedule.semesterOrder.includes(semester);
}

export function addCourse(
  catalog: CourseCatalog,
  schedule: ScheduleState,
  courseName: string,
  semester: string,
): { schedule: ScheduleState; course: CourseInstance } {
  if (!hasColumn(schedule, semester)) {
    throw new Error('Select a valid target semester.');
  }

  const occurrenceIndex =
    Math.max(
      0,
      ...Object.values(schedule.coursesById)
        .filter((course) => course.name === courseName)
        .map((course) => course.occurrenceIndex),
    ) + 1;
  const course = createCourse(catalog, courseName, occurrenceIndex, semester);

  return {
    course,
    schedule: {
      ...schedule,
      coursesById: { ...schedule.coursesById, [course.id]: course },
      columnCourseIds: {
        ...schedule.columnCourseIds,
        [semester]: [...(schedule.columnCourseIds[semester] ?? []), course.id],
      },
    },
  };
}

export function removeCourse(schedule: ScheduleState, courseId: string): ScheduleState {
  const course = schedule.coursesById[courseId];
  if (!course) {
    return schedule;
  }

  const { [courseId]: _removed, ...coursesById } = schedule.coursesById;
  return {
    ...schedule,
    coursesById,
    columnCourseIds: {
      ...schedule.columnCourseIds,
      [course.semester]: (schedule.columnCourseIds[course.semester] ?? []).filter(
        (id) => id !== courseId,
      ),
    },
  };
}

/** Move a card to `targetIndex` in `targetSemester` (the end when omitted). */
export function moveCourse(
  schedule: ScheduleState,
  courseId: string,
  targetSemester: string,
  targetIndex?: number,
): ScheduleState {
  const course = schedule.coursesById[courseId];
  const sourceSemester = course?.semester;
  const sourceIds = [...(schedule.columnCourseIds[sourceSemester] ?? [])];
  const sourceIndex = sourceIds.indexOf(courseId);
  if (!course || sourceIndex < 0 || !hasColumn(schedule, targetSemester)) {
    return schedule;
  }
  sourceIds.splice(sourceIndex, 1);

  const sameColumn = sourceSemester === targetSemester;
  const destinationIds = sameColumn
    ? sourceIds
    : [...(schedule.columnCourseIds[targetSemester] ?? [])];

  let destinationIndex =
    targetIndex === undefined
      ? destinationIds.length
      : Math.max(0, Math.min(targetIndex, destinationIds.length));
  if (sameColumn && targetIndex !== undefined && targetIndex > sourceIndex) {
    destinationIndex -= 1;
  }
  destinationIds.splice(destinationIndex, 0, courseId);

  return {
    ...schedule,
    columnCourseIds: {
      ...schedule.columnCourseIds,
      [sourceSemester]: sourceIds,
      [targetSemester]: destinationIds,
    },
    coursesById: { ...schedule.coursesById, [courseId]: { ...course, semester: targetSemester } },
  };
}

/** Move a card one column left (-1) or right (1); no-op at either end. */
export function shiftCourse(
  schedule: ScheduleState,
  courseId: string,
  direction: -1 | 1,
): ScheduleState {
  const course = schedule.coursesById[courseId];
  const columns = boardColumns(schedule);
  const nextSemester = course && columns[columns.indexOf(course.semester) + direction];
  return nextSemester ? moveCourse(schedule, courseId, nextSemester) : schedule;
}

export function setCourseCredits(
  catalog: CourseCatalog,
  schedule: ScheduleState,
  courseId: string,
  credits: number,
): ScheduleState {
  const course = schedule.coursesById[courseId];
  if (!course || !getValidCredits(catalog, course.name).includes(credits)) {
    return schedule;
  }
  return {
    ...schedule,
    coursesById: { ...schedule.coursesById, [courseId]: { ...course, credits } },
  };
}

function assertNewTerm(schedule: ScheduleState, key: string): void {
  if (key === PRECOLLEGE_SEMESTER || !isSemesterKey(key)) {
    throw new Error(`'${key}' is not a valid semester.`);
  }
  if (schedule.semesterOrder.includes(key)) {
    throw new Error(`${formatSemester(key)} is already in the plan.`);
  }
}

export function addSemester(schedule: ScheduleState, key: string): ScheduleState {
  assertNewTerm(schedule, key);
  return {
    ...schedule,
    semesterOrder: sortSemesters([...schedule.semesterOrder, key]),
    columnCourseIds: { ...schedule.columnCourseIds, [key]: [] },
  };
}

/** Delete a term column and every course in it. */
export function removeSemester(schedule: ScheduleState, key: string): ScheduleState {
  if (!schedule.semesterOrder.includes(key)) {
    return schedule;
  }

  const removedIds = new Set(schedule.columnCourseIds[key] ?? []);
  const { [key]: _removed, ...columnCourseIds } = schedule.columnCourseIds;
  return {
    semesterOrder: schedule.semesterOrder.filter((semester) => semester !== key),
    columnCourseIds,
    coursesById: Object.fromEntries(
      Object.entries(schedule.coursesById).filter(([id]) => !removedIds.has(id)),
    ),
  };
}

/** Relabel a term column (e.g. fall25 -> summer25); columns re-sort by date. */
export function renameSemester(schedule: ScheduleState, from: string, to: string): ScheduleState {
  if (from === to || !schedule.semesterOrder.includes(from)) {
    return schedule;
  }
  assertNewTerm(schedule, to);

  const ids = schedule.columnCourseIds[from] ?? [];
  const { [from]: _old, ...columnCourseIds } = schedule.columnCourseIds;
  const coursesById = { ...schedule.coursesById };
  for (const id of ids) {
    coursesById[id] = { ...coursesById[id], semester: to };
  }

  return {
    semesterOrder: sortSemesters(schedule.semesterOrder.map((key) => (key === from ? to : key))),
    columnCourseIds: { ...columnCourseIds, [to]: ids },
    coursesById,
  };
}

/** Per course id, its position among all copies of the same course (board order), when repeated. */
export function repeatPositions(
  schedule: ScheduleState,
): Record<string, { position: number; total: number }> {
  const idsByName: Record<string, string[]> = {};
  for (const semester of boardColumns(schedule)) {
    for (const id of schedule.columnCourseIds[semester] ?? []) {
      const course = schedule.coursesById[id];
      if (course) {
        (idsByName[course.name] ??= []).push(id);
      }
    }
  }

  const positions: Record<string, { position: number; total: number }> = {};
  for (const ids of Object.values(idsByName)) {
    if (ids.length > 1) {
      ids.forEach((id, index) => (positions[id] = { position: index + 1, total: ids.length }));
    }
  }
  return positions;
}
