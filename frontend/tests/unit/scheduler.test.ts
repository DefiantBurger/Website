import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildCreditOverlapIndex,
  buildSchedule,
  exportSchedule,
  getValidCredits,
  parseCatalogFile,
  parseCourseEntry,
  parseScheduleFile,
  resolveCourseQuery,
  requirementText,
  searchCatalog,
} from '../../src/lib/scheduler/catalog.ts';
import { commit, createHistory, redo, undo } from '../../src/lib/scheduler/history.ts';
import {
  detangleCourseOrder,
  findCreditOverlaps,
  listProblems,
  scheduleGraph,
} from '../../src/lib/scheduler/logic.ts';
import {
  addCourse,
  addSemester,
  boardColumns,
  emptySchedule,
  moveCourse,
  nudgeCourse,
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
import type {
  CourseCatalogFile,
  CourseCatalogRecord,
  PrereqEdge,
  RequirementNode,
  ScheduleState,
  SchedulerGraph,
} from '../../src/lib/scheduler/types.ts';

// Small made-up catalog in the version 2 file format, covering fixed and
// variable credits, alternatives, nesting, atleast, and scoped concurrency.
// Kept separate from the real course_data.json so the tests don't break when
// the catalog is regenerated.
const course = (
  title: string,
  credits: number | [number, number],
  ...rows: RequirementNode[]
): CourseCatalogRecord => ({
  title,
  ...(Array.isArray(credits) ? { min_credits: credits[0], max_credits: credits[1] } : { credits }),
  requisites_text: rows.length > 0 ? 'made up' : '',
  requires: rows.length > 0 ? { all: rows } : null,
  not_open_with_credit_for: [],
  last_taught: null,
});

const catalogFile: CourseCatalogFile = {
  version: 2,
  generated: '2026-11-09',
  source: 'test',
  courses: {
    'MATH 221': course('Calculus I', 5),
    'MATH 222': course('Calculus II', 4, 'MATH 221'),
    'PHYSICS 201': course('Physics I', 5, { any: ['MATH 222'], concurrent: true }),
    'E C E 252': course('Digital Systems', 3),
    'E C E 352': course('Digital System Fundamentals', 3, 'E C E 252', {
      any: ['MATH 222', 'PHYSICS 201'],
    }),
    'E C E 399': course('Independent Study', [1, 3]),
    'ECON 101': course('Microeconomics', 4),
    'ECON 102': course('Macroeconomics', 4),
    'ECON 111': course('Principles Accelerated', 4),
    'ECON 301': course('Intermediate Micro', 4, {
      any: [{ all: ['ECON 101', 'ECON 102'] }, 'ECON 111'],
    }),
    'ART 458': course('Typography', 3),
    'ART 463': course('Interaction Design', 3),
    'ART 465': course('Motion Design', 3),
    'ART 560': course('Senior Thesis', 3, {
      atleast: 2,
      of: ['ART 458', 'ART 463', 'ART 465'],
    }),
    // Listed on one side only, as in the real catalog.
    'MATH 340': { ...course('Linear Algebra', 3), not_open_with_credit_for: ['MATH 341'] },
    'MATH 341': course('Linear Algebra Proofs', 3),
    'CBE 310': course('Transport Phenomena', 3),
    'CHEM 561': course('Physical Chemistry', 3),
    'CBE 320': course('Reactor Design', 3, {
      any: ['CBE 310', { any: ['CHEM 561'], concurrent: true }],
    }),
  },
};
const catalog = parseCatalogFile(catalogFile);

const graphFor = (schedule: ScheduleState) => scheduleGraph(catalog, schedule);
// [status, matched course ids] for each requirement row of a course.
const rowStatuses = (graph: SchedulerGraph, courseId: string) =>
  graph.requirementChecksByCourseId[courseId].map((check) => [
    check.status,
    check.matchedCourseIds,
  ]);

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

describe('parseCatalogFile', () => {
  test('unwraps a version 2 file', () => {
    assert.equal(parseCatalogFile(catalogFile), catalogFile.courses);
  });

  test('rejects other versions and the old unversioned format', () => {
    assert.throws(
      () => parseCatalogFile({ ...catalogFile, version: 3 }),
      /version 3.*expected version 2/,
    );
    assert.throws(() => parseCatalogFile({ 'MATH 221': {} }), /version none/);
    assert.throws(() => parseCatalogFile(null), /expected version 2/);
    assert.throws(() => parseCatalogFile({ version: 2 }), /no courses/);
  });
});

describe('requirementText', () => {
  test('renders rows readably, marking concurrent courses', () => {
    const text = (name: string) => requirementText(catalog[name].requires!.all[0]);
    assert.equal(text('E C E 352'), 'E C E 252');
    assert.equal(requirementText({ any: ['ART 102', 'ART 107'] }), 'ART 102 or ART 107');
    assert.equal(text('ECON 301'), 'ECON 101 and ECON 102, or ECON 111');
    assert.equal(text('ART 560'), '2 of: ART 458, ART 463, ART 465');
    assert.equal(text('CBE 320'), 'CBE 310 or CHEM 561*');
    assert.equal(text('PHYSICS 201'), 'MATH 222*');
    assert.equal(
      requirementText({ any: [{ all: ['A 1', { any: ['B 1', 'C 1'] }] }, 'D 1'] }),
      '(A 1 and (B 1 or C 1)) or D 1',
    );
    assert.equal(
      requirementText({ atleast: 2, of: [{ all: ['A 1', 'B 1'] }, 'C 1', 'D 1'] }),
      '2 of: (A 1 and B 1), C 1, D 1',
    );
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
  test('skips bad course entries when asked, keeping occurrence numbering intact', () => {
    const skipped: string[] = [];
    const schedule = buildSchedule(
      catalog,
      { semesters: { fall24: ['NOPE 100', 'E C E 399[9]', 'E C E 399', 'MATH 221[x]'] } },
      skipped,
    );
    assert.deepEqual(skipped, ['NOPE 100', 'E C E 399[9]', 'MATH 221[x]']);
    assert.deepEqual(schedule.columnCourseIds.fall24, ['E C E 399__1']);
    assert.throws(
      () => buildSchedule(catalog, { semesters: { 'Fall 1': ['MATH 221'] } }, []),
      /Unknown semester/,
    );
  });
});

describe('parseScheduleFile', () => {
  test('accepts a well-formed file', () => {
    const file = { semesters: { fall24: ['MATH 221'] } };
    assert.equal(parseScheduleFile(file), file);
  });

  test('rejects anything without a semesters object of string lists', () => {
    for (const value of [null, 3, 'x', [], {}, { semesters: 'x' }]) {
      assert.throws(() => parseScheduleFile(value), /semesters field/);
    }
    assert.throws(() => parseScheduleFile({ semesters: { fall24: 'MATH 221' } }), /list of course/);
    assert.throws(() => parseScheduleFile({ semesters: { fall24: [5] } }), /list of course/);
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

  test('checks each row: met, concurrent, out of order, or missing', () => {
    const schedule = buildSchedule(catalog, {
      semesters: { fall24: ['MATH 222', 'PHYSICS 201', 'E C E 352'], spring25: ['MATH 221'] },
    });
    const graph = graphFor(schedule);

    assert.deepEqual(rowStatuses(graph, 'MATH 222__1'), [['out-of-order', ['MATH 221__1']]]);
    assert.deepEqual(rowStatuses(graph, 'PHYSICS 201__1'), [['concurrent', ['MATH 222__1']]]);
    assert.deepEqual(rowStatuses(graph, 'E C E 352__1'), [
      ['missing', []],
      ['out-of-order', ['MATH 222__1']],
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
    assert.deepEqual(rowStatuses(graphFor(schedule), 'E C E 352__1')[1], [
      'met',
      ['PHYSICS 201__1'],
    ]);
  });

  test('nested any/all: a complete pair or the single alternative', () => {
    const check = (semesters: Record<string, string[]>) =>
      rowStatuses(graphFor(buildSchedule(catalog, { semesters })), 'ECON 301__1')[0];

    assert.deepEqual(check({ fall24: ['ECON 101', 'ECON 102'], spring25: ['ECON 301'] }), [
      'met',
      ['ECON 101__1', 'ECON 102__1'],
    ]);
    // Half the pair isn't enough, but the scheduled half still decides the row.
    assert.deepEqual(check({ fall24: ['ECON 101'], spring25: ['ECON 301'] }), [
      'missing',
      ['ECON 101__1'],
    ]);
    // A met alternative beats a pair with one course too late.
    assert.deepEqual(
      check({ fall24: ['ECON 101', 'ECON 111'], spring25: ['ECON 301'], fall25: ['ECON 102'] }),
      ['met', ['ECON 111__1']],
    );
    // With no met option, the pair is only as good as its worst course.
    assert.deepEqual(check({ fall24: ['ECON 101'], spring25: ['ECON 301', 'ECON 102'] }), [
      'out-of-order',
      ['ECON 101__1', 'ECON 102__1'],
    ]);
  });

  test('atleast: satisfied, not enough, and out of order', () => {
    const check = (semesters: Record<string, string[]>) => {
      const graph = graphFor(buildSchedule(catalog, { semesters }));
      return {
        row: rowStatuses(graph, 'ART 560__1')[0],
        edges: graph.edges.filter((edge) => edge.toCourseId === 'ART 560__1').length,
      };
    };

    // Takes the two earliest of three met options.
    assert.deepEqual(
      check({
        fall24: ['ART 463'],
        spring25: ['ART 465'],
        fall25: ['ART 458'],
        spring26: ['ART 560'],
      }),
      { row: ['met', ['ART 463__1', 'ART 465__1']], edges: 2 },
    );
    assert.deepEqual(check({ fall24: ['ART 458'], spring25: ['ART 560'] }), {
      row: ['missing', ['ART 458__1']],
      edges: 1,
    });
    // The second-best option is in the same semester, which isn't allowed here.
    assert.deepEqual(check({ fall24: ['ART 458'], spring25: ['ART 560', 'ART 463'] }), {
      row: ['out-of-order', ['ART 458__1', 'ART 463__1']],
      edges: 2,
    });
  });

  test('concurrency is scoped to the marked node', () => {
    const run = (semesters: Record<string, string[]>) => {
      const graph = graphFor(buildSchedule(catalog, { semesters }));
      return {
        row: rowStatuses(graph, 'CBE 320__1')[0],
        edges: graph.edges
          .filter((edge) => edge.toCourseId === 'CBE 320__1')
          .map((edge) => [edge.fromCourseId, edge.status]),
      };
    };

    assert.deepEqual(run({ fall24: ['CBE 320', 'CHEM 561'] }), {
      row: ['concurrent', ['CHEM 561__1']],
      edges: [['CHEM 561__1', 'concurrent']],
    });
    // CBE 310 is outside the concurrent node, so the same semester is too late.
    assert.deepEqual(run({ fall24: ['CBE 320', 'CBE 310'] }), {
      row: ['out-of-order', ['CBE 310__1']],
      edges: [['CBE 310__1', 'invalid']],
    });
    // Met beats concurrent.
    assert.deepEqual(run({ fall24: ['CBE 310'], spring25: ['CBE 320', 'CHEM 561'] }), {
      row: ['met', ['CBE 310__1']],
      edges: [['CBE 310__1', 'valid']],
    });
  });

  test('edge ids are unique per course, row, and leaf', () => {
    const schedule = buildSchedule(catalog, {
      semesters: {
        fall24: ['MATH 221', 'E C E 252', 'ECON 101', 'ECON 102'],
        spring25: ['MATH 222', 'ECON 301'],
        fall25: ['E C E 352', 'E C E 352'],
      },
    });
    const ids = graphFor(schedule).edges.map((edge) => edge.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes('ECON 301__1__0__ECON 102__1'));
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

describe('credit overlaps', () => {
  const overlapIndex = buildCreditOverlapIndex(catalog);
  const overlapsFor = (semesters: Record<string, string[]>) =>
    findCreditOverlaps(buildSchedule(catalog, { semesters }), overlapIndex).map((overlap) => [
      overlap.courseId,
      overlap.otherCourseId,
    ]);

  test('the index is symmetric', () => {
    assert.deepEqual(overlapIndex['MATH 340'], ['MATH 341']);
    assert.deepEqual(overlapIndex['MATH 341'], ['MATH 340']);
    assert.equal(overlapIndex['MATH 221'], undefined);
  });

  test('flags the later course of a pair, whichever side lists it', () => {
    assert.deepEqual(overlapsFor({ fall24: ['MATH 341'], spring25: ['MATH 340'] }), [
      ['MATH 340__1', 'MATH 341__1'],
    ]);
    assert.deepEqual(overlapsFor({ fall24: ['MATH 340'], spring25: ['MATH 341'] }), [
      ['MATH 341__1', 'MATH 340__1'],
    ]);
    // Same semester: the lower card is the redundant one.
    assert.deepEqual(overlapsFor({ fall24: ['MATH 341', 'MATH 340'] }), [
      ['MATH 340__1', 'MATH 341__1'],
    ]);
  });

  test('precollege credit counts, but a pair already earned is not flagged', () => {
    assert.deepEqual(overlapsFor({ [PRECOLLEGE_SEMESTER]: ['MATH 340'], fall24: ['MATH 341'] }), [
      ['MATH 341__1', 'MATH 340__1'],
    ]);
    assert.deepEqual(overlapsFor({ [PRECOLLEGE_SEMESTER]: ['MATH 340', 'MATH 341'] }), []);
    assert.deepEqual(overlapsFor({ fall24: ['MATH 340', 'MATH 340'] }), []);
  });

  test('overlaps appear in the problem list', () => {
    const schedule = buildSchedule(catalog, {
      semesters: { fall24: ['MATH 340'], spring25: ['MATH 341'] },
    });
    const problems = listProblems(
      schedule,
      graphFor(schedule),
      findCreditOverlaps(schedule, overlapIndex),
    );
    assert.deepEqual(problems, [
      { courseId: 'MATH 341__1', checks: [], overlapsWith: ['MATH 340__1'] },
    ]);
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
    // Shifting keeps the card's row, clamped to the target column's length.
    assert.deepEqual(shiftCourse(base(), 'MATH 222__1', 1).columnCourseIds.spring25, [
      'MATH 222__1',
      'E C E 352__1',
    ]);
    assert.deepEqual(shiftCourse(base(), 'E C E 252__1', 1).columnCourseIds.spring25, [
      'E C E 352__1',
      'E C E 252__1',
    ]);

    const down = nudgeCourse(base(), 'MATH 222__1', 1);
    assert.deepEqual(down.columnCourseIds.fall24, ['E C E 252__1', 'MATH 222__1']);
    assert.deepEqual(nudgeCourse(down, 'MATH 222__1', -1).columnCourseIds.fall24, [
      'MATH 222__1',
      'E C E 252__1',
    ]);
    const top = base();
    assert.equal(nudgeCourse(top, 'MATH 222__1', -1), top);
    assert.equal(nudgeCourse(top, 'E C E 252__1', 1), top);

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
