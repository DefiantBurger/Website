// Scheduler page state shared by its components. Schedule edits go through `apply`, which
// records undo history; the edits themselves are pure functions in schedule.ts.
import { errorMessage } from '../api';
import { getValidCredits } from './catalog';
import { createHistory, commit, redo, undo } from './history';
import { detangleCourseOrder, listProblems, scheduleGraph } from './logic';
import { boardColumns, emptySchedule, repeatPositions } from './schedule';
import type { CourseCatalog, ScheduleState } from './types';

export type Notice = { kind: 'error' | 'success'; text: string };

export class SchedulerStore {
  catalog = $state.raw<CourseCatalog>({});
  history = $state.raw(createHistory<ScheduleState>(emptySchedule()));
  selectedCourseId = $state<string | null>(null);
  notice = $state<Notice | null>(null);
  // Set to ask a card to scroll into view; the card clears it. An object so repeat clicks re-fire.
  revealRequest = $state<{ courseId: string } | null>(null);

  // Drag and drop between columns.
  draggedCourseId: string | null = null;
  dragOverSemester = $state<string | null>(null);

  readonly schedule = $derived(this.history.present);
  readonly columns = $derived(boardColumns(this.schedule));
  readonly graph = $derived(scheduleGraph(this.catalog, this.schedule));
  readonly problems = $derived(listProblems(this.schedule, this.graph));
  readonly repeats = $derived(repeatPositions(this.schedule));
  readonly canUndo = $derived(this.history.past.length > 0);
  readonly canRedo = $derived(this.history.future.length > 0);

  readonly selectedCourse = $derived(
    this.selectedCourseId ? (this.schedule.coursesById[this.selectedCourseId] ?? null) : null,
  );
  readonly selectedCourseCredits = $derived(
    this.selectedCourse ? getValidCredits(this.catalog, this.selectedCourse.name) : [],
  );

  /** Replace everything without an undo step (initial load). */
  load(catalog: CourseCatalog, schedule: ScheduleState): void {
    this.catalog = catalog;
    this.history = createHistory(this.detangled(schedule));
    this.selectedCourseId = null;
  }

  /** Run an edit and record it; a thrown error becomes the notice instead. */
  apply(edit: (schedule: ScheduleState) => ScheduleState, success?: string): boolean {
    try {
      this.history = commit(this.history, edit(this.schedule));
      this.notice = success ? { kind: 'success', text: success } : null;
      return true;
    } catch (error) {
      this.notice = { kind: 'error', text: errorMessage(error, 'That change failed.') };
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

  /** Select a course and scroll its card into view. */
  reveal(courseId: string): void {
    this.selectedCourseId = courseId;
    this.revealRequest = { courseId };
  }

  progressPercent(courseId: string): number | null {
    const progress = this.graph.requirementProgressByCourseId[courseId];
    return typeof progress === 'number' ? Math.round(progress * 100) : null;
  }
}
