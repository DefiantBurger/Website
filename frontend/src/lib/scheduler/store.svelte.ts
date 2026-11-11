// Scheduler page state shared by its components. Schedule edits go through `apply`, which
// records undo history; the edits themselves are pure functions in schedule.ts.
import { errorMessage } from '../api';
import { buildCreditOverlapIndex, getValidCredits } from './catalog';
import { createHistory, commit, redo, undo } from './history';
import { formatSemester } from './semesters';
import { detangleCourseOrder, findCreditOverlaps, listProblems, scheduleGraph } from './logic';
import { boardColumns, emptySchedule, removeCourse, repeatPositions } from './schedule';
import type { CourseCatalog, ScheduleState } from './types';

export type Notice = { kind: 'error' | 'success'; text: string };

export class SchedulerStore {
  catalog = $state.raw<CourseCatalog>({});
  history = $state.raw(createHistory<ScheduleState>(emptySchedule()));
  selectedCourseId = $state<string | null>(null);
  notice = $state<Notice | null>(null);
  // Set to ask a card to scroll into view; the card clears it. An object so repeat clicks re-fire.
  revealRequest = $state<{ courseId: string; fromKeyboard: boolean } | null>(null);

  // Drag and drop between columns.
  draggedCourseId = $state<string | null>(null);
  dragOverSemester = $state<string | null>(null);
  // The one insertion line on the board; null when the pointer isn't over a gap that would move the card.
  dropLine = $state<{ courseId: string; after: boolean } | null>(null);

  endDrag(): void {
    this.draggedCourseId = null;
    this.dragOverSemester = null;
    this.dropLine = null;
  }

  readonly schedule = $derived(this.history.present);
  readonly columns = $derived(boardColumns(this.schedule));
  readonly graph = $derived(scheduleGraph(this.catalog, this.schedule));
  readonly creditOverlapIndex = $derived(buildCreditOverlapIndex(this.catalog));
  readonly creditOverlaps = $derived(findCreditOverlaps(this.schedule, this.creditOverlapIndex));
  readonly problems = $derived(listProblems(this.schedule, this.graph, this.creditOverlaps));
  readonly repeats = $derived(repeatPositions(this.schedule));
  readonly canUndo = $derived(this.history.past.length > 0);
  readonly canRedo = $derived(this.history.future.length > 0);

  readonly selectedCourse = $derived(
    this.selectedCourseId ? (this.schedule.coursesById[this.selectedCourseId] ?? null) : null,
  );
  readonly selectedCourseCredits = $derived(
    this.selectedCourse ? getValidCredits(this.catalog, this.selectedCourse.name) : [],
  );

  /** Replace everything without an undo step (initial load). Shared plans keep their card order. */
  load(catalog: CourseCatalog, schedule: ScheduleState, detangle = true): void {
    this.catalog = catalog;
    this.history = createHistory(detangle ? this.detangled(schedule) : schedule);
    this.selectedCourseId = null;
  }

  fail(text: string): void {
    this.notice = { kind: 'error', text };
  }

  succeed(text: string): void {
    this.notice = { kind: 'success', text };
  }

  /** Run an edit and record it; a thrown error becomes the notice instead. */
  apply(edit: (schedule: ScheduleState) => ScheduleState, success?: string): boolean {
    try {
      this.history = commit(this.history, edit(this.schedule));
      if (success) {
        this.succeed(success);
      } else {
        this.notice = null;
      }
      return true;
    } catch (error) {
      this.fail(errorMessage(error, 'That change failed.'));
      return false;
    }
  }

  undo(): void {
    this.history = undo(this.history);
    this.notice = null;
  }

  redo(): void {
    this.history = redo(this.history);
    this.notice = null;
  }

  removeSelectedCourse(): void {
    const course = this.selectedCourse;
    if (!course) {
      return;
    }
    this.apply(
      (schedule) => removeCourse(schedule, course.id),
      `Removed ${course.name} from ${formatSemester(course.semester)}.`,
    );
    this.selectedCourseId = null;
  }

  /** Reorder cards within each column to reduce crossing edges. */
  detangled(schedule: ScheduleState): ScheduleState {
    return {
      ...schedule,
      columnCourseIds: detangleCourseOrder(
        boardColumns(schedule),
        schedule.columnCourseIds,
        scheduleGraph(this.catalog, schedule).edges,
      ),
    };
  }

  /** Select a course and scroll its card into view; after a keyboard move, focus follows the card. */
  reveal(courseId: string, fromKeyboard = false): void {
    this.selectedCourseId = courseId;
    this.revealRequest = { courseId, fromKeyboard };
  }

  /** Scheduled courses that can't count for credit alongside this one (either side of a pair). */
  overlapPartners(courseId: string): string[] {
    return this.creditOverlaps.flatMap((overlap) =>
      overlap.courseId === courseId
        ? [overlap.otherCourseId]
        : overlap.otherCourseId === courseId
          ? [overlap.courseId]
          : [],
    );
  }

  progressPercent(courseId: string): number | null {
    const progress = this.graph.requirementProgressByCourseId[courseId];
    return typeof progress === 'number' ? Math.round(progress * 100) : null;
  }
}
