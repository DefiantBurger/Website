// Course catalog helpers and conversion between schedule files and course instances.
import type {
  CourseCatalog,
  CourseCatalogFile,
  CourseCatalogRecord,
  CourseInstance,
  Requirement,
  RequirementNode,
  ScheduleFile,
  ScheduleState,
} from './types';
import { PRECOLLEGE_SEMESTER, isSemesterKey, sortSemesters } from './semesters';

/** Own-property lookup, so names like `constructor` don't match `Object.prototype`. */
function lookupCourse(catalog: CourseCatalog, courseName: string) {
  return Object.hasOwn(catalog, courseName) ? catalog[courseName] : undefined;
}

function catalogEntry(catalog: CourseCatalog, courseName: string) {
  const item = lookupCourse(catalog, courseName);
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
  if (!/^\d+$/.test(creditText)) {
    throw new Error(
      `Malformed course entry '${entry}': '${creditText}' is not a valid credit count.`,
    );
  }

  return { courseName, requestedCredits: Number(creditText) };
}

/** Credit options for a course, lowest (the default) first. */
export function getValidCredits(catalog: CourseCatalog, courseName: string): number[] {
  const item = lookupCourse(catalog, courseName);
  return item ? creditOptions(item) : [];
}

function creditOptions(item: CourseCatalogRecord): number[] {
  if (typeof item.credits === 'number') {
    return [item.credits];
  }

  const minCredits = item.min_credits ?? 0;
  const maxCredits = item.max_credits ?? minCredits;
  return Array.from(
    { length: Math.max(1, maxCredits - minCredits + 1) },
    (_, index) => minCredits + index,
  );
}

/** Validate requested credits against the catalog; defaults to the lowest valid value. */
function resolveCredits(
  item: CourseCatalogRecord,
  courseName: string,
  requestedCredits?: number,
): number {
  const validCredits = creditOptions(item);

  if (requestedCredits === undefined) {
    return validCredits[0];
  }

  if (!validCredits.includes(requestedCredits)) {
    throw new Error(
      `Course '${courseName}' requested with ${requestedCredits} credits, valid options: ${validCredits.join(', ')}`,
    );
  }

  return requestedCredits;
}

/** Unwrap `course_data.json`, failing clearly on any format but version 2. */
export function parseCatalogFile(value: unknown): CourseCatalog {
  const file = value as Partial<CourseCatalogFile> | null;
  if (!file || typeof file !== 'object' || file.version !== 2) {
    const found = file && typeof file === 'object' ? (file.version ?? 'none') : typeof value;
    throw new Error(`Unsupported course catalog format (version ${found}); expected version 2.`);
  }
  if (!file.courses || typeof file.courses !== 'object') {
    throw new Error('Course catalog has no courses object.');
  }
  return file.courses;
}

/**
 * Courses that can't both count for credit, by course. Symmetric, because the
 * catalog usually lists the pair on only one side (MATH 340 lists MATH 341, not
 * the reverse).
 */
export function buildCreditOverlapIndex(catalog: CourseCatalog): Record<string, string[]> {
  const index: Record<string, Set<string>> = {};
  for (const [name, record] of Object.entries(catalog)) {
    for (const other of record.not_open_with_credit_for ?? []) {
      if (other !== name) {
        (index[name] ??= new Set()).add(other);
        (index[other] ??= new Set()).add(name);
      }
    }
  }
  return Object.fromEntries(
    Object.entries(index).map(([name, others]) => [name, [...others].sort()]),
  );
}

/** One `Requirement` per item of the top-level `all`. */
export function buildRequirements(catalog: CourseCatalog, courseName: string): Requirement[] {
  return (lookupCourse(catalog, courseName)?.requires?.all ?? []).map((node, index) => ({
    key: String(index),
    node,
  }));
}

/** A run of requirement text; `concurrent` marks a course that may be taken in the same semester. */
export interface RequirementPart {
  text: string;
  concurrent?: boolean;
}

function childrenOf(node: Exclude<RequirementNode, string>): RequirementNode[] {
  return 'all' in node ? node.all : 'any' in node ? node.any : node.of;
}

// A one-child any/all (e.g. `{"any": ["X"], "concurrent": true}`) reads as its child.
function unwrap(node: RequirementNode): RequirementNode {
  while (typeof node !== 'string' && !('atleast' in node) && childrenOf(node).length === 1) {
    node = childrenOf(node)[0];
  }
  return node;
}

const isComposite = (node: RequirementNode) => typeof unwrap(node) !== 'string';
// Small enough to read without parentheses: an any/all of plain courses.
function isFlat(node: RequirementNode): boolean {
  const inner = unwrap(node);
  return (
    typeof inner !== 'string' &&
    !('atleast' in inner) &&
    childrenOf(inner).every((child) => !isComposite(child))
  );
}

/**
 * Render a requirement row as text parts: "ART 102 or ART 107", "ECON 101 and
 * ECON 102, or ECON 111", "2 of: ART 458, ART 463". Flat groups directly under
 * the row stay bare (joined with ", or"/", and"); deeper groups get parentheses.
 */
export function requirementParts(
  node: RequirementNode,
  concurrent = false,
  isRoot = true,
): RequirementPart[] {
  if (typeof node === 'string') {
    return [{ text: node, ...(concurrent && { concurrent: true }) }];
  }

  const childConcurrent = concurrent || ('any' in node && node.concurrent === true);
  const children = childrenOf(node);
  if (children.length === 1 && !('atleast' in node)) {
    return requirementParts(children[0], childConcurrent, isRoot);
  }
  const bareGroups = isRoot && !('atleast' in node);
  const isBareGroup = (child: RequirementNode) => bareGroups && isComposite(child) && isFlat(child);
  const rendered = children.map((child) => {
    const parts = requirementParts(child, childConcurrent, false);
    return isComposite(child) && !isBareGroup(child)
      ? [{ text: '(' }, ...parts, { text: ')' }]
      : parts;
  });

  if ('atleast' in node) {
    return [{ text: `${node.atleast} of: ` }, ...joinParts(rendered, ', ')];
  }
  const word = 'all' in node ? 'and' : 'or';
  const hasBareGroup = children.some(isBareGroup);
  return joinParts(rendered, hasBareGroup ? `, ${word} ` : ` ${word} `);
}

function joinParts(groups: RequirementPart[][], separator: string): RequirementPart[] {
  return groups.flatMap((parts, index) => (index === 0 ? parts : [{ text: separator }, ...parts]));
}

export function createCourse(
  catalog: CourseCatalog,
  courseName: string,
  occurrenceIndex: number,
  semester: string,
  requestedCredits?: number,
): CourseInstance {
  const item = catalogEntry(catalog, courseName);
  return {
    id: `${courseName}__${occurrenceIndex}`,
    name: courseName,
    occurrenceIndex,
    semester,
    credits: resolveCredits(item, courseName, requestedCredits),
    title: item.title,
  };
}

/** Check the shape of untrusted JSON (an imported file or a share link) before building it. */
export function parseScheduleFile(value: unknown): ScheduleFile {
  const semesters = (value as { semesters?: unknown } | null)?.semesters;
  if (!value || typeof value !== 'object' || !semesters || typeof semesters !== 'object') {
    throw new Error('Invalid schedule format. Expected an object with a semesters field.');
  }
  for (const [key, entries] of Object.entries(semesters)) {
    if (!Array.isArray(entries) || !entries.every((entry) => typeof entry === 'string')) {
      throw new Error(`Semester '${key}' must be a list of course codes.`);
    }
  }
  return value as ScheduleFile;
}

/**
 * Expand a schedule file into course instances: one column per semester, sorted by date.
 * Bad course entries throw, unless `skipped` is given: then they're left out and listed there,
 * so an old link still loads after the catalog changes.
 */
export function buildSchedule(
  catalog: CourseCatalog,
  scheduleFile: ScheduleFile,
  skipped?: string[],
): ScheduleState {
  const { semesters } = scheduleFile;
  for (const key of Object.keys(semesters)) {
    if (!isSemesterKey(key)) {
      throw new Error(
        `Unknown semester '${key}'. Use precollege or a term and two-digit year, e.g. fall24, winter25.`,
      );
    }
  }

  const semesterOrder = sortSemesters(
    Object.keys(semesters).filter((semester) => semester !== PRECOLLEGE_SEMESTER),
  );
  const coursesById: Record<string, CourseInstance> = {};
  const columnCourseIds: Record<string, string[]> = Object.fromEntries(
    [PRECOLLEGE_SEMESTER, ...semesterOrder].map((semester) => [semester, [] as string[]]),
  );
  const occurrenceCounts: Record<string, number> = {};

  // Number occurrences in date order, so `__1` is always the earliest.
  for (const semester of [PRECOLLEGE_SEMESTER, ...semesterOrder]) {
    for (const entry of semesters[semester] ?? []) {
      let course: CourseInstance;
      try {
        const { courseName, requestedCredits } = parseCourseEntry(entry);
        const occurrenceIndex = (occurrenceCounts[courseName] ?? 0) + 1;
        course = createCourse(catalog, courseName, occurrenceIndex, semester, requestedCredits);
        occurrenceCounts[courseName] = occurrenceIndex;
      } catch (error) {
        if (!skipped) {
          throw error;
        }
        skipped.push(entry);
        continue;
      }
      coursesById[course.id] = course;
      columnCourseIds[semester].push(course.id);
    }
  }

  return { semesterOrder, coursesById, columnCourseIds };
}

/** Inverse of `buildSchedule`; credits are written only when they differ from the default. */
export function exportSchedule(catalog: CourseCatalog, schedule: ScheduleState): ScheduleFile {
  const formatEntry = (course: CourseInstance) =>
    course.credits === getValidCredits(catalog, course.name)[0]
      ? course.name
      : `${course.name}[${course.credits}]`;
  const entriesFor = (semester: string) =>
    (schedule.columnCourseIds[semester] ?? [])
      .map((courseId) => schedule.coursesById[courseId])
      .filter((course) => !!course)
      .map(formatEntry);

  const semesters: Record<string, string[]> = {};
  const precollegeEntries = entriesFor(PRECOLLEGE_SEMESTER);
  if (precollegeEntries.length > 0) {
    semesters[PRECOLLEGE_SEMESTER] = precollegeEntries;
  }
  for (const semester of schedule.semesterOrder) {
    semesters[semester] = entriesFor(semester);
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
export function searchCatalog(
  catalog: CourseCatalog,
  query: string,
  limit = 20,
): CatalogSuggestion[] {
  const lowerQuery = query.trim().toLowerCase();
  const compactQuery = compactKey(query);

  return Object.entries(catalog)
    .filter(
      ([name, item]) =>
        !lowerQuery ||
        name.toLowerCase().includes(lowerQuery) ||
        item.title.toLowerCase().includes(lowerQuery) ||
        compactKey(name).includes(compactQuery),
    )
    .sort(([aName], [bName]) => aName.localeCompare(bName))
    .slice(0, limit)
    .map(([name, item]) => {
      const display = `${name}: ${item.title}`;
      const compactCode = compactDisplayCode(name);
      return {
        name,
        display,
        labels: compactCode === name ? [display] : [display, `${compactCode}: ${item.title}`],
      };
    });
}

/** Resolve free text (a code, "CODE: Title", or a unique search hit) to a catalog course name. */
export function resolveCourseQuery(
  catalog: CourseCatalog,
  query: string,
  suggestions: CatalogSuggestion[],
): string | null {
  const candidate = query.trim();
  if (!candidate) {
    return null;
  }

  const code = candidate.includes(':')
    ? candidate.slice(0, candidate.indexOf(':')).trim()
    : candidate;
  const names = Object.keys(catalog);

  return (
    (lookupCourse(catalog, code) ? code : undefined) ??
    names.find((name) => name.toLowerCase() === code.toLowerCase()) ??
    names.find((name) => compactKey(name) === compactKey(code)) ??
    suggestions.find((item) => item.display.toLowerCase() === candidate.toLowerCase())?.name ??
    (suggestions.length === 1 ? suggestions[0].name : null)
  );
}
