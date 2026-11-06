import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  PRECOLLEGE_SEMESTER,
  buildRequirements,
  buildSchedule,
  exportSchedule,
  getValidCredits,
  parseCourseEntry,
  resolveCourseQuery,
  searchCatalog
} from '../../src/lib/scheduler/catalog.ts';
import { computeSchedulerGraph, detangleCourseOrder } from '../../src/lib/scheduler/logic.ts';
import type { CourseCatalog, PrereqEdge, ScheduleState } from '../../src/lib/scheduler/types.ts';

// Small made-up catalog covering fixed and variable credits, alternatives, and
// concurrent prereqs. Kept separate from the real course_data.json so the tests
// don't break when the catalog is regenerated.
const catalog: CourseCatalog = {
  'MATH 221': { title: 'Calculus I', credits: 5, prereqs: [], concurrent_prereqs: [] },
  'MATH 222': { title: 'Calculus II', credits: 4, prereqs: [['MATH 221']], concurrent_prereqs: [] },
  'PHYSICS 201': { title: 'Physics I', credits: 5, prereqs: [], concurrent_prereqs: [['MATH 222']] },
  'E C E 252': { title: 'Digital Systems', credits: 3, prereqs: [], concurrent_prereqs: [] },
  'E C E 352': {
    title: 'Digital System Fundamentals',
    credits: 3,
    prereqs: [['E C E 252'], ['MATH 222', 'PHYSICS 201']],
    concurrent_prereqs: []
  },
  'E C E 399': { title: 'Independent Study', min_credits: 1, max_credits: 3, prereqs: [], concurrent_prereqs: [] }
};

/** Run the graph the way the scheduler page does, from a built schedule. */
function graphFor(schedule: ScheduleState) {
  const semesterToIndex: Record<string, number> = { [PRECOLLEGE_SEMESTER]: -1 };
  schedule.semesterOrder.forEach((semester, index) => {
    semesterToIndex[semester] = index;
  });
  const prereqsByCourseId = Object.fromEntries(
    Object.values(schedule.coursesById).map((course) => [course.id, buildRequirements(catalog, course.name)])
  );
  return computeSchedulerGraph({ coursesById: schedule.coursesById, prereqsByCourseId, semesterToIndex });
}

describe('parseCourseEntry', () => {
  test('plain names, trimmed', () => {
    assert.deepEqual(parseCourseEntry('  MATH 221 '), { courseName: 'MATH 221' });
  });

  test('bracketed credit count', () => {
    assert.deepEqual(parseCourseEntry('E C E 399[2]'), { courseName: 'E C E 399', requestedCredits: 2 });
  });

  test('rejects malformed brackets and credits', () => {
    assert.throws(() => parseCourseEntry('E C E 399[2'), /bracket not closed/);
    assert.throws(() => parseCourseEntry('E C E 399[x]'), /not a valid credit count/);
    assert.throws(() => parseCourseEntry('E C E 399[-1]'), /not a valid credit count/);
  });
});

describe('getValidCredits', () => {
  test('fixed, ranged, and unknown courses', () => {
    assert.deepEqual(getValidCredits(catalog, 'MATH 221'), [5]);
    assert.deepEqual(getValidCredits(catalog, 'E C E 399'), [1, 2, 3]);
    assert.deepEqual(getValidCredits(catalog, 'NOPE 100'), []);
  });

  test('ignores Object.prototype names', () => {
    assert.deepEqual(getValidCredits(catalog, 'constructor'), []);
  });
});

describe('buildSchedule / exportSchedule', () => {
  const file = {
    semesters: {
      [PRECOLLEGE_SEMESTER]: ['MATH 221'],
      'Fall 1': ['MATH 222', 'E C E 252', 'E C E 399[2]'],
      'Spring 1': ['E C E 352', 'E C E 399']
    }
  };

  test('builds one column per non-precollege semester', () => {
    const schedule = buildSchedule(catalog, file);
    assert.deepEqual(schedule.semesterOrder, ['Fall 1', 'Spring 1']);
    assert.deepEqual(schedule.columnCourseIds['Fall 1'], ['MATH 222__1', 'E C E 252__1', 'E C E 399__1']);
    assert.equal(schedule.coursesById['MATH 221__1'].semester, PRECOLLEGE_SEMESTER);
  });

  test('numbers repeated courses and resolves credits', () => {
    const schedule = buildSchedule(catalog, file);
    assert.equal(schedule.coursesById['E C E 399__1'].credits, 2);
    assert.equal(schedule.coursesById['E C E 399__2'].credits, 1);
  });

  test('round-trips to the same file', () => {
    assert.deepEqual(exportSchedule(catalog, buildSchedule(catalog, file)), file);
  });

  test('rejects unknown courses, invalid credits, and empty schedules', () => {
    assert.throws(() => buildSchedule(catalog, { semesters: { F: ['NOPE 100'] } }), /not in the loaded course catalog/);
    assert.throws(() => buildSchedule(catalog, { semesters: { F: ['MATH 221[3]'] } }), /valid options: 5/);
    assert.throws(
      () => buildSchedule(catalog, { semesters: { [PRECOLLEGE_SEMESTER]: ['MATH 221'] } }),
      /at least one non-precollege semester/
    );
  });
});

describe('searchCatalog / resolveCourseQuery', () => {
  test('matches code, title, and compacted code', () => {
    assert.deepEqual(
      searchCatalog(catalog, 'calculus').map((item) => item.name),
      ['MATH 221', 'MATH 222']
    );
    assert.deepEqual(
      searchCatalog(catalog, 'ece352').map((item) => item.name),
      ['E C E 352']
    );
  });

  test('offers a compact label for spaced codes', () => {
    const [hit] = searchCatalog(catalog, 'E C E 252');
    assert.deepEqual(hit.labels, ['E C E 252: Digital Systems', 'ECE 252: Digital Systems']);
  });

  test('respects the limit', () => {
    assert.equal(searchCatalog(catalog, '', 2).length, 2);
  });

  test('resolves codes typed loosely', () => {
    const resolve = (query: string) => resolveCourseQuery(catalog, query, searchCatalog(catalog, query));
    assert.equal(resolve('math 222'), 'MATH 222');
    assert.equal(resolve('ECE 252'), 'E C E 252');
    assert.equal(resolve('E C E 352: anything'), 'E C E 352');
    assert.equal(resolve('Independent'), 'E C E 399');
    assert.equal(resolve('calculus'), null);
    assert.equal(resolve('   '), null);
  });
});

describe('computeSchedulerGraph', () => {
  test('marks edges valid, concurrent, or invalid by semester order', () => {
    const schedule = buildSchedule(catalog, {
      semesters: {
        'Fall 1': ['MATH 221', 'PHYSICS 201', 'MATH 222', 'E C E 352'],
        'Spring 1': ['E C E 252']
      }
    });
    const { edges } = graphFor(schedule);
    const status = (to: string, from: string) =>
      edges.find((edge) => edge.toCourseId === to && edge.fromCourseId === from)?.status;

    // Same semester, non-concurrent prereq.
    assert.equal(status('MATH 222__1', 'MATH 221__1'), 'invalid');
    // Same semester, concurrent allowed.
    assert.equal(status('PHYSICS 201__1', 'MATH 222__1'), 'concurrent');
    // Prereq scheduled after the course.
    assert.equal(status('E C E 352__1', 'E C E 252__1'), 'invalid');
  });

  test('progress counts satisfied groups and skips precollege ones', () => {
    const schedule = buildSchedule(catalog, {
      semesters: {
        [PRECOLLEGE_SEMESTER]: ['MATH 221'],
        'Fall 1': ['MATH 222'],
        'Spring 1': ['E C E 352']
      }
    });
    const { edges, requirementProgressByCourseId } = graphFor(schedule);

    // MATH 221 was precollege: no edge, and nothing left to satisfy.
    assert.ok(!edges.some((edge) => edge.fromCourseId === 'MATH 221__1'));
    assert.equal(requirementProgressByCourseId['MATH 222__1'], undefined);
    // E C E 352: MATH 222 satisfies one group; E C E 252 isn't scheduled.
    assert.equal(requirementProgressByCourseId['E C E 352__1'], 0.5);
  });

  test('uses the earliest instance among alternatives', () => {
    const schedule = buildSchedule(catalog, {
      semesters: {
        'Fall 1': ['PHYSICS 201'],
        'Spring 1': ['MATH 222'],
        'Fall 2': ['E C E 352']
      }
    });
    const edge = graphFor(schedule).edges.find(
      (item) => item.toCourseId === 'E C E 352__1' && item.requirement.courseChoices.length === 2
    );
    assert.equal(edge?.fromCourseId, 'PHYSICS 201__1');
  });
});

describe('detangleCourseOrder', () => {
  const edge = (fromCourseId: string, toCourseId: string): PrereqEdge => ({
    id: `${toCourseId}__${fromCourseId}`,
    fromCourseId,
    toCourseId,
    requirement: { courseChoices: [], canBeConcurrent: false },
    status: 'valid'
  });

  test('uncrosses two crossed edges', () => {
    const order = detangleCourseOrder(
      ['S1', 'S2'],
      { S1: ['a', 'b'], S2: ['y', 'x'] },
      [edge('a', 'x'), edge('b', 'y')]
    );
    // Either column may be the one that moves; what matters is that each
    // course lines up with its neighbor.
    assert.equal(order.S1.indexOf('a'), order.S2.indexOf('x'));
    assert.equal(order.S1.indexOf('b'), order.S2.indexOf('y'));
  });

  test('keeps every course and leaves the input untouched', () => {
    const columns = { S1: ['a', 'b', 'c'], S2: ['z', 'y', 'x'] };
    const order = detangleCourseOrder(['S1', 'S2'], columns, [edge('a', 'x'), edge('c', 'z')]);
    assert.deepEqual([...order.S1].sort(), ['a', 'b', 'c']);
    assert.deepEqual([...order.S2].sort(), ['x', 'y', 'z']);
    assert.deepEqual(columns, { S1: ['a', 'b', 'c'], S2: ['z', 'y', 'x'] });
  });
});
