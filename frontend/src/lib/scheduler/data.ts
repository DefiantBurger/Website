import type {
  CourseCatalog,
  CourseInstance,
  Requirement,
  ScheduleFile,
  SchedulerData
} from './types';

const PRECOLLEGE_SEMESTER = 'precollege';
const BACKEND_BASE_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:5000';

async function parseJsonResponse<T>(response: Response, resourceName: string): Promise<T> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    const preview = (await response.text()).slice(0, 120).replace(/\s+/g, ' ');
    throw new Error(
      `Expected JSON for ${resourceName}, got '${contentType || 'unknown'}'. Response starts with: ${preview}`
    );
  }

  return (await response.json()) as T;
}

function parseCourseNameWithCredits(courseEntry: string): {
  baseCourse: string;
  requestedCredits?: number;
} {
  if (!courseEntry.includes('[')) {
    return { baseCourse: courseEntry };
  }

  if (!courseEntry.endsWith(']')) {
    throw new Error(`Malformed course entry '${courseEntry}': bracket not closed`);
  }

  const bracketPos = courseEntry.lastIndexOf('[');
  const baseCourse = courseEntry.slice(0, bracketPos).trim();
  const creditText = courseEntry.slice(bracketPos + 1, -1).trim();
  const requestedCredits = Number.parseInt(creditText, 10);

  if (Number.isNaN(requestedCredits)) {
    throw new Error(
      `Malformed course entry '${courseEntry}': '${creditText}' is not a valid integer`
    );
  }

  if (requestedCredits < 0) {
    throw new Error(`Malformed course entry '${courseEntry}': credits cannot be negative`);
  }

  return { baseCourse, requestedCredits };
}

function getCourseCredits(
  catalog: CourseCatalog,
  baseCourseName: string,
  requestedCredits?: number
): number {
  const courseInfo = catalog[baseCourseName];
  if (!courseInfo) {
    throw new Error(`Course '${baseCourseName}' is missing from catalog data.`);
  }

  let validCredits: number[];
  if (typeof courseInfo.credits === 'number') {
    validCredits = [courseInfo.credits];
  } else {
    const minCredits = courseInfo.min_credits ?? 0;
    const maxCredits = courseInfo.max_credits ?? minCredits;
    validCredits = Array.from(
      { length: Math.max(1, maxCredits - minCredits + 1) },
      (_, index) => minCredits + index
    );
  }

  if (requestedCredits === undefined) {
    return validCredits[0];
  }

  if (!validCredits.includes(requestedCredits)) {
    throw new Error(
      `Course '${baseCourseName}' requested with ${requestedCredits} credits, valid options: ${validCredits.join(', ')}`
    );
  }

  return requestedCredits;
}

function toRequirements(catalog: CourseCatalog, courseName: string): Requirement[] {
  const item = catalog[courseName];
  if (!item) {
    return [];
  }

  const requirements: Requirement[] = [];

  for (const group of item.prereqs ?? []) {
    requirements.push({
      courseChoices: group,
      canBeConcurrent: false
    });
  }

  for (const group of item.concurrent_prereqs ?? []) {
    requirements.push({
      courseChoices: group,
      canBeConcurrent: true
    });
  }

  return requirements;
}

export async function loadSchedulerData(): Promise<SchedulerData> {
  const [scheduleResponse, catalogResponse] = await Promise.all([
    fetch(`${BACKEND_BASE_URL}/api/scheduler/default-schedule/`),
    fetch(`${BACKEND_BASE_URL}/api/scheduler/course-data/`)
  ]);

  if (!scheduleResponse.ok) {
    throw new Error('Failed to load starter schedule data.');
  }
  if (!catalogResponse.ok) {
    throw new Error('Failed to load course catalog data.');
  }

  const scheduleData = await parseJsonResponse<ScheduleFile>(
    scheduleResponse,
    'default schedule'
  );
  const catalogData = await parseJsonResponse<CourseCatalog>(
    catalogResponse,
    'course catalog'
  );

  const semesterKeys = Object.keys(scheduleData.semesters);
  const semesterOrder = semesterKeys.filter((semester) => semester !== PRECOLLEGE_SEMESTER);

  const semesterToIndex: Record<string, number> = {
    [PRECOLLEGE_SEMESTER]: -1
  };

  semesterOrder.forEach((semester, index) => {
    semesterToIndex[semester] = index;
  });

  const coursesById: Record<string, CourseInstance> = {};
  const columnCourseIds: Record<string, string[]> = Object.fromEntries(
    semesterOrder.map((semester) => [semester, [] as string[]])
  );
  const prereqsByCourseId: Record<string, Requirement[]> = {};

  const occurrenceCounts: Record<string, number> = {};

  for (const [semester, courseEntries] of Object.entries(scheduleData.semesters)) {
    for (const courseEntry of courseEntries) {
      const { baseCourse, requestedCredits } = parseCourseNameWithCredits(courseEntry);
      const occurrenceIndex = (occurrenceCounts[baseCourse] ?? 0) + 1;
      occurrenceCounts[baseCourse] = occurrenceIndex;

      const id = `${baseCourse}__${occurrenceIndex}`;
      const credits = getCourseCredits(catalogData, baseCourse, requestedCredits);

      coursesById[id] = {
        id,
        name: baseCourse,
        occurrenceIndex,
        semester,
        credits,
        title: catalogData[baseCourse]?.title ?? baseCourse
      };

      if (semester !== PRECOLLEGE_SEMESTER) {
        columnCourseIds[semester].push(id);
      }

      prereqsByCourseId[id] = toRequirements(catalogData, baseCourse);
    }
  }

  return {
    semesterOrder,
    semesterToIndex,
    catalog: catalogData,
    coursesById,
    columnCourseIds,
    prereqsByCourseId
  };
}
