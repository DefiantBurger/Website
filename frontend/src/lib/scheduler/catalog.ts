// Course catalog helpers and conversion between schedule files and course instances.
import type { CourseCatalog, CourseInstance, Requirement, ScheduleFile, ScheduleState } from './types';

/** Courses taken before college: they satisfy prerequisites but get no column. */
export const PRECOLLEGE_SEMESTER = 'precollege';

function catalogEntry(catalog: CourseCatalog, courseName: string) {
  const item = catalog[courseName];
  if (!item) {
    throw new Error(`Course '${courseName}' is not in the loaded course catalog.`);
  }
  return item;
}

/** Split `"COURSE[n]"` into the course name and the requested credit count. */
export function parseCourseEntry(entry: string): { courseName: string; requestedCredits?: number } {
  if (!entry.includes('[')) {
    return { courseName: entry.trim() };
  }

  if (!entry.endsWith(']')) {
    throw new Error(`Malformed course entry '${entry}': bracket not closed.`);
  }

  const bracketPos = entry.lastIndexOf('[');
  const courseName = entry.slice(0, bracketPos).trim();
  const creditText = entry.slice(bracketPos + 1, -1).trim();
  const requestedCredits = Number.parseInt(creditText, 10);

  if (Number.isNaN(requestedCredits) || requestedCredits < 0) {
    throw new Error(`Malformed course entry '${entry}': '${creditText}' is not a valid credit count.`);
  }

  return { courseName, requestedCredits };
}

/** Credit options for a course, lowest (the default) first. */
export function getValidCredits(catalog: CourseCatalog, courseName: string): number[] {
  const item = catalog[courseName];
  if (!item) {
    return [];
  }

  if (typeof item.credits === 'number') {
    return [item.credits];
  }

  const minCredits = item.min_credits ?? 0;
  const maxCredits = item.max_credits ?? minCredits;
  return Array.from({ length: Math.max(1, maxCredits - minCredits + 1) }, (_, index) => minCredits + index);
}

/** Validate requested credits against the catalog; defaults to the lowest valid value. */
function resolveCredits(catalog: CourseCatalog, courseName: string, requestedCredits?: number): number {
  catalogEntry(catalog, courseName);
  const validCredits = getValidCredits(catalog, courseName);

  if (requestedCredits === undefined) {
    return validCredits[0];
  }

  if (!validCredits.includes(requestedCredits)) {
    throw new Error(
      `Course '${courseName}' requested with ${requestedCredits} credits, valid options: ${validCredits.join(', ')}`
    );
  }

  return requestedCredits;
}

export function buildRequirements(catalog: CourseCatalog, courseName: string): Requirement[] {
  const item = catalog[courseName];
  if (!item) {
    return [];
  }

  return [
    ...(item.prereqs ?? []).map((group) => ({ courseChoices: group, canBeConcurrent: false })),
    ...(item.concurrent_prereqs ?? []).map((group) => ({ courseChoices: group, canBeConcurrent: true }))
  ];
}

export function createCourse(
  catalog: CourseCatalog,
  courseName: string,
  occurrenceIndex: number,
  semester: string,
  requestedCredits?: number
): CourseInstance {
  return {
    id: `${courseName}__${occurrenceIndex}`,
    name: courseName,
    occurrenceIndex,
    semester,
    credits: resolveCredits(catalog, courseName, requestedCredits),
    title: catalogEntry(catalog, courseName).title
  };
}

/** Expand a schedule file into course instances, one column per non-precollege semester. */
export function buildSchedule(catalog: CourseCatalog, scheduleFile: ScheduleFile): ScheduleState {
  const semesters = scheduleFile.semesters ?? {};
  const semesterOrder = Object.keys(semesters).filter((semester) => semester !== PRECOLLEGE_SEMESTER);
  if (semesterOrder.length === 0) {
    throw new Error('A schedule must include at least one non-precollege semester.');
  }

  const coursesById: Record<string, CourseInstance> = {};
  const columnCourseIds: Record<string, string[]> = Object.fromEntries(
    semesterOrder.map((semester) => [semester, [] as string[]])
  );
  const occurrenceCounts: Record<string, number> = {};

  for (const [semester, entries] of Object.entries(semesters)) {
    for (const entry of entries) {
      const { courseName, requestedCredits } = parseCourseEntry(entry);
      const occurrenceIndex = (occurrenceCounts[courseName] ?? 0) + 1;
      occurrenceCounts[courseName] = occurrenceIndex;

      const course = createCourse(catalog, courseName, occurrenceIndex, semester, requestedCredits);
      coursesById[course.id] = course;
      columnCourseIds[semester]?.push(course.id);
    }
  }

  return { semesterOrder, coursesById, columnCourseIds };
}

/** Inverse of `buildSchedule`; credits are written only when they differ from the default. */
export function exportSchedule(catalog: CourseCatalog, schedule: ScheduleState): ScheduleFile {
  const formatEntry = (course: CourseInstance) =>
    course.credits === getValidCredits(catalog, course.name)[0] ? course.name : `${course.name}[${course.credits}]`;

  const semesters: Record<string, string[]> = {};

  const precollegeEntries = Object.values(schedule.coursesById)
    .filter((course) => course.semester === PRECOLLEGE_SEMESTER)
    .sort((a, b) => a.occurrenceIndex - b.occurrenceIndex)
    .map(formatEntry);
  if (precollegeEntries.length > 0) {
    semesters[PRECOLLEGE_SEMESTER] = precollegeEntries;
  }

  for (const semester of schedule.semesterOrder) {
    semesters[semester] = (schedule.columnCourseIds[semester] ?? [])
      .map((courseId) => schedule.coursesById[courseId])
      .filter((course) => !!course)
      .map(formatEntry);
  }

  return { semesters };
}

function compactKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "E C E 252" -> "ECE 252", so codes can be typed without the catalog's spacing. */
function compactDisplayCode(courseName: string): string {
  const firstDigitIndex = courseName.search(/\d/);
  if (firstDigitIndex < 0) {
    return courseName.replace(/\s+/g, ' ').trim();
  }

  const prefix = courseName.slice(0, firstDigitIndex).replace(/[^A-Za-z]/g, '');
  const suffix = courseName.slice(firstDigitIndex).replace(/\s+/g, ' ').trim();
  return `${prefix} ${suffix}`.trim();
}

export type CatalogSuggestion = { name: string; display: string; labels: string[] };

/** Up to `limit` catalog courses whose code or title matches `query`, sorted by code. */
export function searchCatalog(catalog: CourseCatalog, query: string, limit = 20): CatalogSuggestion[] {
  const lowerQuery = query.trim().toLowerCase();
  const compactQuery = compactKey(query);

  return Object.entries(catalog)
    .filter(
      ([name, item]) =>
        !lowerQuery ||
        name.toLowerCase().includes(lowerQuery) ||
        item.title.toLowerCase().includes(lowerQuery) ||
        compactKey(name).includes(compactQuery)
    )
    .sort(([aName], [bName]) => aName.localeCompare(bName))
    .slice(0, limit)
    .map(([name, item]) => {
      const display = `${name}: ${item.title}`;
      const compactCode = compactDisplayCode(name);
      return {
        name,
        display,
        labels: compactCode === name ? [display] : [display, `${compactCode}: ${item.title}`]
      };
    });
}

/** Resolve free text (a code, "CODE: Title", or a unique search hit) to a catalog course name. */
export function resolveCourseQuery(
  catalog: CourseCatalog,
  query: string,
  suggestions: CatalogSuggestion[]
): string | null {
  const candidate = query.trim();
  if (!candidate) {
    return null;
  }

  const code = candidate.includes(':') ? candidate.slice(0, candidate.indexOf(':')).trim() : candidate;
  const names = Object.keys(catalog);

  return (
    (catalog[code] ? code : undefined) ??
    names.find((name) => name.toLowerCase() === code.toLowerCase()) ??
    names.find((name) => compactKey(name) === compactKey(code)) ??
    suggestions.find((item) => item.display.toLowerCase() === candidate.toLowerCase())?.name ??
    (suggestions.length === 1 ? suggestions[0].name : null)
  );
}
