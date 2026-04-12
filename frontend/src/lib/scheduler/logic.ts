import type { PrereqEdge, Requirement, SchedulerGraph } from './types';

const PRECOLLEGE_SEMESTER = 'precollege';

interface ComputeGraphParams {
  coursesById: Record<string, { id: string; name: string; semester: string }>;
  prereqsByCourseId: Record<string, Requirement[]>;
  semesterToIndex: Record<string, number>;
}

function chooseBestRequirementCourse(
  requirement: Requirement,
  courseIdsByName: Record<string, string[]>,
  coursesById: Record<string, { id: string; semester: string }>,
  semesterToIndex: Record<string, number>
): string | undefined {
  let bestCourseId: string | undefined;

  for (const option of requirement.courseChoices) {
    const candidateIds = courseIdsByName[option];
    if (!candidateIds || candidateIds.length === 0) {
      continue;
    }

    for (const candidateId of candidateIds) {
      if (!bestCourseId) {
        bestCourseId = candidateId;
        continue;
      }

      const bestIndex = semesterToIndex[coursesById[bestCourseId].semester] ?? Number.MAX_SAFE_INTEGER;
      const candidateIndex = semesterToIndex[coursesById[candidateId].semester] ?? Number.MAX_SAFE_INTEGER;
      if (candidateIndex < bestIndex) {
        bestCourseId = candidateId;
      }
    }
  }

  return bestCourseId;
}

function buildCourseIdsByName(
  coursesById: Record<string, { id: string; name: string; semester: string }>,
  semesterToIndex: Record<string, number>
): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};

  for (const course of Object.values(coursesById)) {
    if (!grouped[course.name]) {
      grouped[course.name] = [];
    }
    grouped[course.name].push(course.id);
  }

  for (const courseName of Object.keys(grouped)) {
    grouped[courseName].sort((a, b) => {
      const aIndex = semesterToIndex[coursesById[a].semester] ?? Number.MAX_SAFE_INTEGER;
      const bIndex = semesterToIndex[coursesById[b].semester] ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }

  return grouped;
}

export function computeSchedulerGraph({
  coursesById,
  prereqsByCourseId,
  semesterToIndex
}: ComputeGraphParams): SchedulerGraph {
  const courseIdsByName = buildCourseIdsByName(coursesById, semesterToIndex);
  const edges: PrereqEdge[] = [];
  const requirementProgressByCourseId: Record<string, number> = {};

  for (const [courseId, requirements] of Object.entries(prereqsByCourseId)) {
    let expectedRequirementCount = requirements.length;
    let satisfiedRequirementCount = 0;

    for (const requirement of requirements) {
      const bestRequirementCourseId = chooseBestRequirementCourse(
        requirement,
        courseIdsByName,
        coursesById,
        semesterToIndex
      );

      if (!bestRequirementCourseId) {
        continue;
      }

      const requirementSemester = coursesById[bestRequirementCourseId].semester;
      if (requirementSemester === PRECOLLEGE_SEMESTER) {
        expectedRequirementCount -= 1;
        continue;
      }

      const courseSemesterIndex = semesterToIndex[coursesById[courseId].semester] ?? Number.MAX_SAFE_INTEGER;
      const reqSemesterIndex = semesterToIndex[requirementSemester] ?? Number.MAX_SAFE_INTEGER;

      let status: PrereqEdge['status'];
      if (courseSemesterIndex > reqSemesterIndex) {
        status = 'valid';
      } else if (courseSemesterIndex < reqSemesterIndex) {
        status = 'invalid';
      } else if (requirement.canBeConcurrent) {
        status = 'concurrent';
      } else {
        status = 'invalid';
      }

      if (status === 'valid' || status === 'concurrent') {
        satisfiedRequirementCount += 1;
      }

      edges.push({
        id: `${courseId}__${bestRequirementCourseId}__${requirement.courseChoices.join('|')}`,
        fromCourseId: bestRequirementCourseId,
        toCourseId: courseId,
        requirement,
        status
      });
    }

    if (expectedRequirementCount > 0) {
      requirementProgressByCourseId[courseId] = satisfiedRequirementCount / expectedRequirementCount;
    }
  }

  return { edges, requirementProgressByCourseId };
}

export function detangleCourseOrder(
  semesterOrder: string[],
  columnCourseIds: Record<string, string[]>,
  edges: PrereqEdge[]
): Record<string, string[]> {
  const result: Record<string, string[]> = Object.fromEntries(
    semesterOrder.map((semester) => [semester, [...(columnCourseIds[semester] ?? [])]])
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
          currentPosition
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
