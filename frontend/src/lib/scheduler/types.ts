/** One prerequisite group: satisfied by any one of `courseChoices`. */
export interface Requirement {
  courseChoices: string[];
  canBeConcurrent: boolean;
}

export interface CourseCatalogRecord {
  title: string;
  // Fixed credits, or a min_credits..max_credits range for variable-credit courses.
  credits?: number;
  min_credits?: number;
  max_credits?: number;
  // Every group must be satisfied; each group lists alternatives.
  prereqs: string[][];
  // Groups that may also be satisfied in the same semester.
  concurrent_prereqs: string[][];
}

export interface ScheduleFile {
  semesters: Record<string, string[]>;
}

/** One scheduled occurrence of a course; `id` is `<name>__<occurrenceIndex>`. */
export interface CourseInstance {
  id: string;
  name: string;
  occurrenceIndex: number;
  semester: string;
  credits: number;
  title: string;
}

export type CourseCatalog = Record<string, CourseCatalogRecord>;

/** The editable schedule: which course instances exist and how each column is ordered. */
export interface ScheduleState {
  // Term keys in date order; excludes precollege, which is always the first column.
  semesterOrder: string[];
  coursesById: Record<string, CourseInstance>;
  // Card order per column, precollege included.
  columnCourseIds: Record<string, string[]>;
}

export type RequirementStatus = 'valid' | 'invalid' | 'concurrent';

export interface PrereqEdge {
  id: string;
  fromCourseId: string;
  toCourseId: string;
  requirement: Requirement;
  status: RequirementStatus;
}

/** How one requirement group of a course is (or isn't) satisfied. */
export interface RequirementCheck {
  requirement: Requirement;
  // `out-of-order`: the best option is scheduled, but not early enough.
  status: 'met' | 'concurrent' | 'out-of-order' | 'missing';
  // The course instance chosen to satisfy the group; absent when missing.
  satisfiedByCourseId?: string;
}

export interface SchedulerGraph {
  edges: PrereqEdge[];
  requirementProgressByCourseId: Record<string, number>;
  requirementChecksByCourseId: Record<string, RequirementCheck[]>;
}

/** A course with at least one out-of-order or missing requirement group. */
export interface ScheduleProblem {
  courseId: string;
  checks: RequirementCheck[];
}
