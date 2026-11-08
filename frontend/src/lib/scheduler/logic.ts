import { buildRequirements } from './catalog';
import { PRECOLLEGE_SEMESTER } from './semesters';
import type {
  CourseCatalog,
  PrereqEdge,
  RequirementCheck,
  Requirement,
  ScheduleProblem,
  ScheduleState,
  SchedulerGraph,
} from './types';

interface ComputeGraphParams {
  coursesById: Record<string, { id: string; name: string; semester: string }>;
  prereqsByCourseId: Record<string, Requirement[]>;
  semesterToIndex: Record<string, number>;
}

/** Column index of a semester; unknown semesters sort last. */
function indexOf(semesterToIndex: Record<string, number>, semester: string): number {
  return semesterToIndex[semester] ?? Number.MAX_SAFE_INTEGER;
}

/** Precollege is -1, then each term in date order. */
export function semesterIndexMap(schedule: ScheduleState): Record<string, number> {
  return {
    [PRECOLLEGE_SEMESTER]: -1,
    ...Object.fromEntries(schedule.semesterOrder.map((semester, index) => [semester, index])),
  };
}

/** Pick the earliest-scheduled course instance that can satisfy the requirement. */
function chooseBestRequirementCourse(
  requirement: Requirement,
  courseIdsByName: Record<string, string[]>,
  coursesById: Record<string, { id: string; semester: string }>,
  semesterToIndex: Record<string, number>,
): string | undefined {
  let bestCourseId: string | undefined;

  for (const option of requirement.courseChoices) {
    for (const candidateId of courseIdsByName[option] ?? []) {
      if (
        !bestCourseId ||
        indexOf(semesterToIndex, coursesById[candidateId].semester) <
          indexOf(semesterToIndex, coursesById[bestCourseId].semester)
      ) {
        bestCourseId = candidateId;
      }
    }
  }

  return bestCourseId;
}

function buildCourseIdsByName(
  coursesById: Record<string, { id: string; name: string; semester: string }>,
  semesterToIndex: Record<string, number>,
): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};

  for (const course of Object.values(coursesById)) {
    (grouped[course.name] ??= []).push(course.id);
  }

  for (const ids of Object.values(grouped)) {
    ids.sort(
      (a, b) =>
        indexOf(semesterToIndex, coursesById[a].semester) -
        indexOf(semesterToIndex, coursesById[b].semester),
    );
  }

  return grouped;
}

/**
 * Build prerequisite edges, a check per requirement group, and each course's
 * progress (satisfied groups / all groups). Precollege courses are taken as
 * already earned, so their own requirements aren't checked.
 */
export function computeSchedulerGraph({
  coursesById,
  prereqsByCourseId,
  semesterToIndex,
}: ComputeGraphParams): SchedulerGraph {
  const courseIdsByName = buildCourseIdsByName(coursesById, semesterToIndex);
  const edges: PrereqEdge[] = [];
  const requirementProgressByCourseId: Record<string, number> = {};
  const requirementChecksByCourseId: Record<string, RequirementCheck[]> = {};

  for (const [courseId, requirements] of Object.entries(prereqsByCourseId)) {
    const courseSemester = coursesById[courseId].semester;
    if (courseSemester === PRECOLLEGE_SEMESTER || requirements.length === 0) {
      continue;
    }

    const checks: RequirementCheck[] = [];
    for (const requirement of requirements) {
      const satisfiedByCourseId = chooseBestRequirementCourse(
        requirement,
        courseIdsByName,
        coursesById,
        semesterToIndex,
      );
      if (!satisfiedByCourseId) {
        checks.push({ requirement, status: 'missing' });
        continue;
      }

      const courseIndex = indexOf(semesterToIndex, courseSemester);
      const reqIndex = indexOf(semesterToIndex, coursesById[satisfiedByCourseId].semester);

      let status: PrereqEdge['status'];
      if (courseIndex > reqIndex) {
        status = 'valid';
      } else if (courseIndex === reqIndex && requirement.canBeConcurrent) {
        status = 'concurrent';
      } else {
        status = 'invalid';
      }

      checks.push({
        requirement,
        satisfiedByCourseId,
        status:
          status === 'valid' ? 'met' : status === 'concurrent' ? 'concurrent' : 'out-of-order',
      });
      edges.push({
        id: `${courseId}__${satisfiedByCourseId}__${requirement.courseChoices.join('|')}`,
        fromCourseId: satisfiedByCourseId,
        toCourseId: courseId,
        requirement,
        status,
      });
    }

    requirementChecksByCourseId[courseId] = checks;
    requirementProgressByCourseId[courseId] =
      checks.filter((check) => check.status === 'met' || check.status === 'concurrent').length /
      checks.length;
  }

  return { edges, requirementProgressByCourseId, requirementChecksByCourseId };
}

/** The graph for a whole schedule, as the scheduler page draws it. */
export function scheduleGraph(catalog: CourseCatalog, schedule: ScheduleState): SchedulerGraph {
  return computeSchedulerGraph({
    coursesById: schedule.coursesById,
    prereqsByCourseId: Object.fromEntries(
      Object.values(schedule.coursesById).map((course) => [
        course.id,
        buildRequirements(catalog, course.name),
      ]),
    ),
    semesterToIndex: semesterIndexMap(schedule),
  });
}

/** Courses with unmet requirement groups, in board order (column, then card). */
export function listProblems(schedule: ScheduleState, graph: SchedulerGraph): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];
  for (const semester of schedule.semesterOrder) {
    for (const courseId of schedule.columnCourseIds[semester] ?? []) {
      const checks = (graph.requirementChecksByCourseId[courseId] ?? []).filter(
        (check) => check.status === 'out-of-order' || check.status === 'missing',
      );
      if (checks.length > 0) {
        problems.push({ courseId, checks });
      }
    }
  }
  return problems;
}

/**
 * Reorder courses within each semester to reduce edge crossings: repeated
 * forward and backward sweeps sort each column by the mean position of its
 * neighbors (barycenter heuristic).
 */
export function detangleCourseOrder(
  semesterOrder: string[],
  columnCourseIds: Record<string, string[]>,
  edges: PrereqEdge[],
): Record<string, string[]> {
  const result: Record<string, string[]> = Object.fromEntries(
    semesterOrder.map((semester) => [semester, [...(columnCourseIds[semester] ?? [])]]),
  );

  const neighbors: Record<string, Set<string>> = {};
  for (const edge of edges) {
    if (!neighbors[edge.toCourseId]) {
      neighbors[edge.toCourseId] = new Set();
    }
    if (!neighbors[edge.fromCourseId]) {
      neighbors[edge.fromCourseId] = new Set();
    }
    neighbors[edge.toCourseId].add(edge.fromCourseId);
    neighbors[edge.fromCourseId].add(edge.toCourseId);
  }

  const positionInLayer: Record<string, number> = {};
  for (const semester of semesterOrder) {
    for (const [index, courseId] of (result[semester] ?? []).entries()) {
      positionInLayer[courseId] = index;
    }
  }

  const sweep = (semesters: string[]) => {
    for (const semester of semesters) {
      const ids = result[semester] ?? [];

      const scored = ids.map((courseId) => {
        const neighborPositions = Array.from(neighbors[courseId] ?? [])
          .map((neighborId) => positionInLayer[neighborId])
          .filter((position): position is number => typeof position === 'number');

        const currentPosition = positionInLayer[courseId] ?? 0;
        const barycenter =
          neighborPositions.length > 0
            ? neighborPositions.reduce((sum, value) => sum + value, 0) / neighborPositions.length
            : currentPosition;

        return {
          courseId,
          barycenter,
          currentPosition,
        };
      });

      scored.sort((a, b) => {
        if (a.barycenter !== b.barycenter) {
          return a.barycenter - b.barycenter;
        }
        if (a.currentPosition !== b.currentPosition) {
          return a.currentPosition - b.currentPosition;
        }
        return a.courseId.localeCompare(b.courseId);
      });

      result[semester] = scored.map((item) => item.courseId);
      result[semester].forEach((courseId, index) => {
        positionInLayer[courseId] = index;
      });
    }
  };

  for (let i = 0; i < 8; i += 1) {
    sweep(semesterOrder);
    sweep([...semesterOrder].reverse());
  }

  return result;
}
