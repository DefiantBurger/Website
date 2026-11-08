import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildSchedule,
  exportSchedule,
  getValidCredits,
  parseCourseEntry,
  resolveCourseQuery,
  searchCatalog,
} from '../../src/lib/scheduler/catalog.ts';
import { commit, createHistory, redo, undo } from '../../src/lib/scheduler/history.ts';
import { detangleCourseOrder, listProblems, scheduleGraph } from '../../src/lib/scheduler/logic.ts';
import {
  addCourse,
  addSemester,
  boardColumns,
  emptySchedule,
  moveCourse,
  removeCourse,
  removeSemester,
  renameSemester,
  repeatPositions,
  setCourseCredits,
  shiftCourse,
} from '../../src/lib/scheduler/schedule.ts';
import {
  PRECOLLEGE_SEMESTER,
  formatSemester,
  nextMainTerm,
  parseSemesterKey,
  semesterKey,
  sortSemesters,
  upcomingMainTerm,
} from '../../src/lib/scheduler/semesters.ts';
import type { CourseCatalog, PrereqEdge, ScheduleState } from '../../src/lib/scheduler/types.ts';

// Small made-up catalog covering fixed and variable credits, alternatives, and
// concurrent prereqs. Kept separate from the real course_data.json so the tests
// don't break when the catalog is regenerated.
const catalog: CourseCatalog = {
  'MATH 221': { title: 'Calculus I', credits: 5, prereqs: [], concurrent_prereqs: [] },
  'MATH 222': { title: 'Calculus II', credits: 4, prereqs: [['MATH 221']], concurrent_prereqs: [] },
  'PHYSICS 201': {
    title: 'Physics I',
    credits: 5,
    prereqs: [],
    concurrent_prereqs: [['MATH 222']],
  },
  'E C E 252': { title: 'Digital Systems', credits: 3, prereqs: [], concurrent_prereqs: [] },
  'E C E 352': {
    title: 'Digital System Fundamentals',
    credits: 3,
    prereqs: [['E C E 252'], ['MATH 222', 'PHYSICS 201']],
    concurrent_prereqs: [],
  },
  'E C E 399': {
    title: 'Independent Study',
    min_credits: 1,
    max_credits: 3,
    prereqs: [],
    concurrent_prereqs: [],
  },
};

const graphFor = (schedule: ScheduleState) => scheduleGraph(catalog, schedule);

describe('parseCourseEntry', () => {
  test('plain names, trimmed', () => {
    assert.deepEqual(parseCourseEntry('  MATH 221 '), { courseName: 'MATH 221' });
  });

  test('bracketed credit count', () => {
    assert.deepEqual(parseCourseEntry('E C E 399[2]'), {
      courseName: 'E C E 399',
      requestedCredits: 2,
    });
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

describe('semesters', () => {
  test('parses, builds, and formats term keys', () => {
    assert.deepEqual(parseSemesterKey('winter25'), { term: 'winter', year: 2025 });
    assert.equal(parseSemesterKey('Fall24'), null);
    assert.equal(parseSemesterKey(PRECOLLEGE_SEMESTER), null);
    assert.equal(semesterKey({ term: 'summer', year: 2005 }), 'summer05');
    assert.throws(() => semesterKey({ term: 'fall', year: 2100 }), /between 2000 and 2099/);
    assert.equal(formatSemester('fall24'), 'Fall 2024');
    assert.equal(formatSemester(PRECOLLEGE_SEMESTER), 'Precollege');
  });

  test('sorts by year, then winter, spring, summer, fall', () => {
    assert.deepEqual(sortSemesters(['spring25', 'fall24', 'winter25', 'summer25', 'fall25']), [
      'fall24',
      'winter25',
      'spring25',
      'summer25',
      'fall25',
    ]);
  });

  test('next main term skips winter and summer', () => {
    assert.deepEqual(nextMainTerm('fall24'), { term: 'spring', year: 2025 });
    assert.deepEqual(nextMainTerm('spring25'), { term: 'fall', year: 2025 });
    assert.deepEqual(nextMainTerm('summer25'), { term: 'fall', year: 2025 });
    assert.deepEqual(nextMainTerm('winter25'), { term: 'spring', year: 2025 });
    assert.deepEqual(upcomingMainTerm(new Date(2026, 2, 1)), { term: 'spring', year: 2026 });
    assert.deepEqual(upcomingMainTerm(new Date(2026, 7, 1)), { term: 'fall', year: 2026 });
  });
});

describe('buildSchedule / exportSchedule', () => {
  const file = {
    semesters: {
      [PRECOLLEGE_SEMESTER]: ['MATH 221'],
      fall24: ['MATH 222', 'E C E 252', 'E C E 399[2]'],
      spring25: ['E C E 352', 'E C E 399'],
    },
  };

  test('builds a precollege column plus one per term', () => {
    const schedule = buildSchedule(catalog, file);
    assert.deepEqual(schedule.semesterOrder, ['fall24', 'spring25']);
    assert.deepEqual(boardColumns(schedule), [PRECOLLEGE_SEMESTER, 'fall24', 'spring25']);
    assert.deepEqual(schedule.columnCourseIds.fall24, [
      'MATH 222__1',
      'E C E 252__1',
      'E C E 399__1',
    ]);
    assert.deepEqual(schedule.columnCourseIds[PRECOLLEGE_SEMESTER], ['MATH 221__1']);
  });

  test('sorts terms by date whatever the file order', () => {
    const schedule = buildSchedule(catalog, {
      semesters: { spring25: ['MATH 222'], fall24: ['MATH 221'] },
    });
    assert.deepEqual(schedule.semesterOrder, ['fall24', 'spring25']);
  });

  test('numbers repeated courses and resolves credits', () => {
    const schedule = buildSchedule(catalog, file);
    assert.equal(schedule.coursesById['E C E 399__1'].credits, 2);
    assert.equal(schedule.coursesById['E C E 399__2'].credits, 1);
  });

  test('round-trips to the same file, empty plans included', () => {
    assert.deepEqual(exportSchedule(catalog, buildSchedule(catalog, file)), file);
    assert.deepEqual(exportSchedule(catalog, buildSchedule(catalog, { semesters: {} })), {
      semesters: {},
    });
  });

  test('rejects unknown courses, invalid credits, and bad semester keys', () => {
    assert.throws(
      () => buildSchedule(catalog, { semesters: { fall24: ['NOPE 100'] } }),
      /not in the loaded course catalog/,
    );
    assert.throws(
      () => buildSchedule(catalog, { semesters: { fall24: ['MATH 221[3]'] } }),
      /valid options: 5/,
    );
    assert.throws(
      () => buildSchedule(catalog, { semesters: { 'Fall 1': ['MATH 221'] } }),
      /Unknown semester 'Fall 1'/,
    );
  });
});

describe('searchCatalog / resolveCourseQuery', () => {
  test('matches code, title, and compacted code', () => {
    assert.deepEqual(
      searchCatalog(catalog, 'calculus').map((item) => item.name),
      ['MATH 221', 'MATH 222'],
    );
    assert.deepEqual(
      searchCatalog(catalog, 'ece352').map((item) => item.name),
      ['E C E 352'],
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
    const resolve = (query: string) =>
      resolveCourseQuery(catalog, query, searchCatalog(catalog, query));
    assert.equal(resolve('math 222'), 'MATH 222');
    assert.equal(resolve('ECE 252'), 'E C E 252');
    assert.equal(resolve('E C E 352: anything'), 'E C E 352');
    assert.equal(resolve('Independent'), 'E C E 399');
    assert.equal(resolve('calculus'), null);
    assert.equal(resolve('   '), null);
  });
});

describe('scheduleGraph', () => {
  test('marks edges valid, concurrent, or invalid by semester order', () => {
    const schedule = buildSchedule(catalog, {
      semesters: {
        fall24: ['MATH 221', 'PHYSICS 201', 'MATH 222', 'E C E 352'],
        spring25: ['E C E 252'],
      },
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

  test('precollege satisfies requirements with an edge, and is not checked itself', () => {
    const schedule = buildSchedule(catalog, {
      semesters: {
        [PRECOLLEGE_SEMESTER]: ['MATH 221', 'E C E 352'],
        fall24: ['MATH 222'],
        spring25: ['E C E 352'],
      },
    });
    const graph = graphFor(schedule);

    assert.equal(graph.edges.find((edge) => edge.fromCourseId === 'MATH 221__1')?.status, 'valid');
    assert.equal(graph.requirementProgressByCourseId['MATH 222__1'], 1);
    // The precollege E C E 352 has unmet groups but gets no checks or edges.
    assert.equal(graph.requirementChecksByCourseId['E C E 352__1'], undefined);
    assert.ok(!graph.edges.some((edge) => edge.toCourseId === 'E C E 352__1'));
  });

  test('checks each group: met, concurrent, out of order, or missing', () => {
    const schedule = buildSchedule(catalog, {
      semesters: { fall24: ['MATH 222', 'PHYSICS 201', 'E C E 352'], spring25: ['MATH 221'] },
    });
    const graph = graphFor(schedule);
    const statuses = (id: string) =>
      graph.requirementChecksByCourseId[id].map((check) => [
        check.status,
        check.satisfiedByCourseId,
      ]);

    assert.deepEqual(statuses('MATH 222__1'), [['out-of-order', 'MATH 221__1']]);
    assert.deepEqual(statuses('PHYSICS 201__1'), [['concurrent', 'MATH 222__1']]);
    assert.deepEqual(statuses('E C E 352__1'), [
      ['missing', undefined],
      ['out-of-order', 'MATH 222__1'],
    ]);
    assert.equal(graph.requirementProgressByCourseId['E C E 352__1'], 0);
    assert.equal(graph.requirementProgressByCourseId['PHYSICS 201__1'], 1);
  });

  test('uses the earliest instance among alternatives', () => {
    const schedule = buildSchedule(catalog, {
      semesters: {
        fall24: ['PHYSICS 201'],
        spring25: ['MATH 222'],
        fall25: ['E C E 352'],
      },
    });
    const edge = graphFor(schedule).edges.find(
      (item) => item.toCourseId === 'E C E 352__1' && item.requirement.courseChoices.length === 2,
    );
    assert.equal(edge?.fromCourseId, 'PHYSICS 201__1');
  });

  test('lists problems in board order with only the unmet groups', () => {
    const schedule = buildSchedule(catalog, {
      semesters: {
        [PRECOLLEGE_SEMESTER]: ['MATH 221'],
        fall24: ['E C E 352', 'MATH 222'],
        spring25: ['E C E 352'],
      },
    });
    const problems = listProblems(schedule, graphFor(schedule));
    assert.deepEqual(
      problems.map((problem) => [problem.courseId, problem.checks.map((check) => check.status)]),
      [
        ['E C E 352__1', ['missing', 'out-of-order']],
        ['E C E 352__2', ['missing']],
      ],
    );
  });
});

describe('schedule edits', () => {
  const base = () =>
    buildSchedule(catalog, {
      semesters: {
        [PRECOLLEGE_SEMESTER]: ['MATH 221'],
        fall24: ['MATH 222', 'E C E 252'],
        spring25: ['E C E 352'],
      },
    });

  test('add course numbers the next occurrence and leaves the input alone', () => {
    const before = base();
    const { schedule, course } = addCourse(catalog, before, 'MATH 221', 'spring25');
    assert.equal(course.id, 'MATH 221__2');
    assert.deepEqual(schedule.columnCourseIds.spring25, ['E C E 352__1', 'MATH 221__2']);
    assert.deepEqual(before, base());
    assert.throws(() => addCourse(catalog, before, 'MATH 221', 'fall30'), /valid target/);
  });

  test('remove, move, shift, and credits', () => {
    const removed = removeCourse(base(), 'MATH 222__1');
    assert.equal(removed.coursesById['MATH 222__1'], undefined);
    assert.deepEqual(removed.columnCourseIds.fall24, ['E C E 252__1']);

    const moved = moveCourse(base(), 'E C E 352__1', 'fall24', 0);
    assert.deepEqual(moved.columnCourseIds.fall24, ['E C E 352__1', 'MATH 222__1', 'E C E 252__1']);
    assert.equal(moved.coursesById['E C E 352__1'].semester, 'fall24');

    // No index: to the end of the column.
    const reordered = moveCourse(base(), 'MATH 222__1', 'fall24');
    assert.deepEqual(reordered.columnCourseIds.fall24, ['E C E 252__1', 'MATH 222__1']);

    const earlier = shiftCourse(base(), 'MATH 222__1', -1);
    assert.equal(earlier.coursesById['MATH 222__1'].semester, PRECOLLEGE_SEMESTER);
    const atEnd = base();
    assert.equal(shiftCourse(atEnd, 'E C E 352__1', 1), atEnd);

    const withCourse = addCourse(catalog, base(), 'E C E 399', 'fall24');
    const credited = setCourseCredits(catalog, withCourse.schedule, 'E C E 399__1', 3);
    assert.equal(credited.coursesById['E C E 399__1'].credits, 3);
    assert.equal(setCourseCredits(catalog, credited, 'E C E 399__1', 9), credited);
  });

  test('add semester keeps date order and rejects duplicates', () => {
    const schedule = addSemester(addSemester(base(), 'fall25'), 'winter25');
    assert.deepEqual(schedule.semesterOrder, ['fall24', 'winter25', 'spring25', 'fall25']);
    assert.deepEqual(schedule.columnCourseIds.winter25, []);
    assert.throws(() => addSemester(schedule, 'fall24'), /Fall 2024 is already in the plan/);
    assert.throws(() => addSemester(schedule, PRECOLLEGE_SEMESTER), /not a valid semester/);
  });

  test('remove semester deletes its courses', () => {
    const schedule = removeSemester(base(), 'fall24');
    assert.deepEqual(schedule.semesterOrder, ['spring25']);
    assert.equal(schedule.columnCourseIds.fall24, undefined);
    assert.deepEqual(Object.keys(schedule.coursesById).sort(), ['E C E 352__1', 'MATH 221__1']);
  });

  test('rename semester moves its courses and re-sorts', () => {
    const schedule = renameSemester(base(), 'fall24', 'fall25');
    assert.deepEqual(schedule.semesterOrder, ['spring25', 'fall25']);
    assert.deepEqual(schedule.columnCourseIds.fall25, ['MATH 222__1', 'E C E 252__1']);
    assert.equal(schedule.coursesById['MATH 222__1'].semester, 'fall25');
    assert.throws(() => renameSemester(base(), 'fall24', 'spring25'), /already in the plan/);
  });

  test('empty schedule exports with no semesters', () => {
    assert.deepEqual(exportSchedule(catalog, emptySchedule()), { semesters: {} });
  });

  test('repeat positions follow board order', () => {
    const { schedule } = addCourse(catalog, base(), 'MATH 221', 'fall24');
    assert.deepEqual(repeatPositions(schedule), {
      'MATH 221__1': { position: 1, total: 2 },
      'MATH 221__2': { position: 2, total: 2 },
    });
  });
});

describe('history', () => {
  test('undo and redo walk the snapshots; a new commit drops redo', () => {
    let history = commit(commit(createHistory(1), 2), 3);
    history = undo(undo(history));
    assert.equal(history.present, 1);
    history = redo(history);
    assert.equal(history.present, 2);
    history = commit(history, 9);
    assert.deepEqual(history, { past: [1, 2], present: 9, future: [] });
    assert.equal(undo(createHistory(1)).present, 1);
  });

  test('ignores unchanged values and caps the past', () => {
    const history = createHistory(0);
    assert.equal(commit(history, 0), history);
    let capped = history;
    for (let value = 1; value <= 5; value += 1) {
      capped = commit(capped, value, 3);
    }
    assert.deepEqual(capped.past, [2, 3, 4]);
  });
});

describe('detangleCourseOrder', () => {
  const edge = (fromCourseId: string, toCourseId: string): PrereqEdge => ({
    id: `${toCourseId}__${fromCourseId}`,
    fromCourseId,
    toCourseId,
    requirement: { courseChoices: [], canBeConcurrent: false },
    status: 'valid',
  });

  test('uncrosses two crossed edges', () => {
    const order = detangleCourseOrder(['S1', 'S2'], { S1: ['a', 'b'], S2: ['y', 'x'] }, [
      edge('a', 'x'),
      edge('b', 'y'),
    ]);
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
