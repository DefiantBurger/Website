import { buildRequirements } from './catalog';
import { boardColumns } from './schedule';
import { PRECOLLEGE_SEMESTER } from './semesters';
import type {
  CheckStatus,
  CourseCatalog,
  CreditOverlap,
  PrereqEdge,
  RequirementCheck,
  RequirementNode,
  RequirementStatus,
  ScheduleProblem,
  ScheduleState,
  SchedulerGraph,
} from './types';

/** Column index of a semester; unknown semesters sort last. */
function indexOf(semesterToIndex: Record<string, number>, semester: string): number {
  return semesterToIndex[semester] ?? Number.MAX_SAFE_INTEGER;
}

const STATUS_RANK: Record<CheckStatus, number> = {
  met: 3,
  concurrent: 2,
  'out-of-order': 1,
  missing: 0,
};

const EDGE_STATUS: Record<Exclude<CheckStatus, 'missing'>, RequirementStatus> = {
  met: 'valid',
  concurrent: 'concurrent',
  'out-of-order': 'invalid',
};

/** A node's result: its status, the semester it depends on, and the leaves that decided it. */
interface NodeResult {
  status: CheckStatus;
  // Latest semester among the deciding leaves; breaks ties toward earlier courses.
  semesterIndex: number;
  leaves: { courseId: string; status: Exclude<CheckStatus, 'missing'> }[];
}

const MISSING: NodeResult = { status: 'missing', semesterIndex: Infinity, leaves: [] };

/** Better status first, then the earlier semester; stable, so row order breaks remaining ties. */
function compareResults(a: NodeResult, b: NodeResult): number {
  return STATUS_RANK[b.status] - STATUS_RANK[a.status] || a.semesterIndex - b.semesterIndex;
}

interface EvaluationContext {
  courseIndex: number;
  courseIdsByName: Record<string, string[]>;
  coursesById: Record<string, { semester: string }>;
  semesterToIndex: Record<string, number>;
}

/**
 * Evaluate a requirement node for a course in column `ctx.courseIndex`. A leaf
 * uses its earliest scheduled instance; `any` takes its best child, `all` its
 * worst, and `atleast k` its k-th best. `concurrent` is true under an `any`
 * marked concurrent.
 */
function evaluateNode(
  node: RequirementNode,
  ctx: EvaluationContext,
  concurrent: boolean,
): NodeResult {
  if (typeof node === 'string') {
    const courseId = ctx.courseIdsByName[node]?.[0];
    if (!courseId) {
      return MISSING;
    }
    const semesterIndex = indexOf(ctx.semesterToIndex, ctx.coursesById[courseId].semester);
    const status: NodeResult['leaves'][number]['status'] =
      semesterIndex < ctx.courseIndex
        ? 'met'
        : semesterIndex === ctx.courseIndex && concurrent
          ? 'concurrent'
          : 'out-of-order';
    return { status, semesterIndex, leaves: [{ courseId, status }] };
  }

  if ('any' in node) {
    const childConcurrent = concurrent || node.concurrent === true;
    const results = node.any.map((child) => evaluateNode(child, ctx, childConcurrent));
    return results.sort(compareResults)[0] ?? MISSING;
  }

  const [children, required] =
    'all' in node ? [node.all, node.all.length] : [node.of, node.atleast];
  const chosen = children
    .map((child) => evaluateNode(child, ctx, concurrent))
    .sort(compareResults)
    .slice(0, required);
  const worst = chosen.at(-1);
  if (!worst || chosen.length < required) {
    return MISSING;
  }
  return {
    status: worst.status,
    semesterIndex: Math.max(...chosen.map((result) => result.semesterIndex)),
    leaves: chosen.flatMap((result) => result.leaves),
  };
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
 * Build prerequisite edges, a check per requirement row, and each course's
 * progress (satisfied rows / all rows). Precollege courses are taken as
 * already earned, so their own requirements aren't checked.
 */
export function scheduleGraph(catalog: CourseCatalog, schedule: ScheduleState): SchedulerGraph {
  const { coursesById } = schedule;
  // Precollege is -1, then each term in date order.
  const semesterToIndex: Record<string, number> = {
    [PRECOLLEGE_SEMESTER]: -1,
    ...Object.fromEntries(schedule.semesterOrder.map((semester, index) => [semester, index])),
  };
  const courseIdsByName = buildCourseIdsByName(coursesById, semesterToIndex);
  const edges: PrereqEdge[] = [];
  const requirementProgressByCourseId: Record<string, number> = {};
  const requirementChecksByCourseId: Record<string, RequirementCheck[]> = {};

  for (const course of Object.values(coursesById)) {
    const requirements = buildRequirements(catalog, course.name);
    if (course.semester === PRECOLLEGE_SEMESTER || requirements.length === 0) {
      continue;
    }

    const ctx: EvaluationContext = {
      courseIndex: indexOf(semesterToIndex, course.semester),
      courseIdsByName,
      coursesById,
      semesterToIndex,
    };
    const checks: RequirementCheck[] = [];
    for (const requirement of requirements) {
      const result = evaluateNode(requirement.node, ctx, false);
      const matchedCourseIds: string[] = [];
      for (const leaf of result.leaves) {
        // The same course can decide a row through two branches; draw it once.
        if (matchedCourseIds.includes(leaf.courseId)) {
          continue;
        }
        matchedCourseIds.push(leaf.courseId);
        edges.push({
          id: `${course.id}__${requirement.key}__${leaf.courseId}`,
          fromCourseId: leaf.courseId,
          toCourseId: course.id,
          status: EDGE_STATUS[leaf.status],
        });
      }
      checks.push({ requirement, status: result.status, matchedCourseIds });
    }

    requirementChecksByCourseId[course.id] = checks;
    requirementProgressByCourseId[course.id] =
      checks.filter((check) => check.status === 'met' || check.status === 'concurrent').length /
      checks.length;
  }

  return { edges, requirementProgressByCourseId, requirementChecksByCourseId };
}

/**
 * Pairs of scheduled courses that can't both count for credit. Uses each
 * course's earliest instance; the later of the two (by semester, then card
 * order) is the redundant one. Pairs entirely in precollege are already earned.
 */
export function findCreditOverlaps(
  schedule: ScheduleState,
  overlapIndex: Record<string, string[]>,
): CreditOverlap[] {
  const position: Record<string, [number, number]> = {};
  const earliestByName: Record<string, string> = {};
  for (const [column, semester] of boardColumns(schedule).entries()) {
    for (const [row, courseId] of (schedule.columnCourseIds[semester] ?? []).entries()) {
      position[courseId] = [column, row];
      earliestByName[schedule.coursesById[courseId].name] ??= courseId;
    }
  }
  const compareBoardOrder = (a: string, b: string) =>
    position[a][0] - position[b][0] || position[a][1] - position[b][1];

  const overlaps: CreditOverlap[] = [];
  for (const [name, courseId] of Object.entries(earliestByName)) {
    for (const otherName of overlapIndex[name] ?? []) {
      const otherCourseId = earliestByName[otherName];
      // Each pair is seen from both sides; keep the side where this course is the later one.
      if (
        otherCourseId &&
        compareBoardOrder(courseId, otherCourseId) > 0 &&
        schedule.coursesById[courseId].semester !== PRECOLLEGE_SEMESTER
      ) {
        overlaps.push({ courseId, otherCourseId });
      }
    }
  }
  return overlaps;
}

/** Courses with unmet requirement rows or redundant credit, in board order (column, then card). */
export function listProblems(
  schedule: ScheduleState,
  graph: SchedulerGraph,
  overlaps: CreditOverlap[] = [],
): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];
  for (const semester of schedule.semesterOrder) {
    for (const courseId of schedule.columnCourseIds[semester] ?? []) {
      const checks = (graph.requirementChecksByCourseId[courseId] ?? []).filter(
        (check) => check.status === 'out-of-order' || check.status === 'missing',
      );
      const overlapsWith = overlaps
        .filter((overlap) => overlap.courseId === courseId)
        .map((overlap) => overlap.otherCourseId);
      if (checks.length > 0 || overlapsWith.length > 0) {
        problems.push({ courseId, checks, overlapsWith });
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
    (neighbors[edge.toCourseId] ??= new Set()).add(edge.fromCourseId);
    (neighbors[edge.fromCourseId] ??= new Set()).add(edge.toCourseId);
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

        return { courseId, barycenter, currentPosition };
      });

      scored.sort(
        (a, b) =>
          a.barycenter - b.barycenter ||
          a.currentPosition - b.currentPosition ||
          a.courseId.localeCompare(b.courseId),
      );

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
