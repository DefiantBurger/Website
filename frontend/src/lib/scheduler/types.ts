/**
 * A requirement tree: a course code, every node, at least one node, or at least
 * `atleast` of the nodes. `concurrent` lets courses anywhere under that `any`
 * be taken in the same semester.
 */
export type RequirementNode =
  | string
  | { all: RequirementNode[] }
  | { any: RequirementNode[]; concurrent?: boolean }
  | { atleast: number; of: RequirementNode[] };

/** One top-level requirement row of a course; every row must be satisfied. */
export interface Requirement {
  // Row index as a string, stable for a given catalog entry.
  key: string;
  node: RequirementNode;
}

export interface CourseCatalogRecord {
  title: string;
  // Fixed credits, or a min_credits..max_credits range for variable-credit courses.
  credits?: number;
  min_credits?: number;
  max_credits?: number;
  // The guide's wording, including conditions `requires` can't express (standing, major, consent).
  requisites_text: string;
  // Each item of `all` is one requirement row.
  requires: { all: RequirementNode[] } | null;
  not_open_with_credit_for: string[];
  last_taught: string | null;
  // Offering history over the file's `offered_window`; optional so an older catalog still loads.
  terms_offered?: OfferedSeason[];
  times_offered?: Record<OfferedSeason, number>;
}

/** Seasons the offering history covers; summer and winter aren't tracked. */
export type OfferedSeason = 'Fall' | 'Spring';

/** The span the offering counts cover; `Fall`/`Spring` are how many of each season it holds. */
export interface OfferedWindow {
  from: string;
  to: string;
  Fall: number;
  Spring: number;
}

/** A course planned in a season it's rarely or never offered in; `count` of `outOf` such terms. */
export interface OfferingWarning {
  kind: 'not-offered' | 'rare';
  season: OfferedSeason;
  count: number;
  outOf: number;
}

/** `course_data.json` as served; only version 2 is supported. */
export interface CourseCatalogFile {
  version: 2;
  generated: string;
  source: string;
  offered_window?: OfferedWindow;
  courses: CourseCatalog;
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

/** An edge from one leaf course that decided a requirement row, with that leaf's own status. */
export interface PrereqEdge {
  id: string;
  fromCourseId: string;
  toCourseId: string;
  status: RequirementStatus;
}

// `out-of-order`: scheduled, but not early enough. Ranked best to worst in this order.
export type CheckStatus = 'met' | 'concurrent' | 'out-of-order' | 'missing';

/** How one requirement row of a course is (or isn't) satisfied. */
export interface RequirementCheck {
  requirement: Requirement;
  status: CheckStatus;
  // Scheduled course instances that decided the status, in row order; empty when nothing is scheduled.
  matchedCourseIds: string[];
}

export interface SchedulerGraph {
  edges: PrereqEdge[];
  requirementProgressByCourseId: Record<string, number>;
  requirementChecksByCourseId: Record<string, RequirementCheck[]>;
}

/** Two scheduled courses that can't both count; `courseId` is the later one, which adds no credit. */
export interface CreditOverlap {
  courseId: string;
  otherCourseId: string;
}

/** A course with out-of-order or missing requirement rows, credit it can't earn, or an unusual term. */
export interface ScheduleProblem {
  courseId: string;
  checks: RequirementCheck[];
  // Earlier courses that make this one redundant.
  overlapsWith: string[];
  offering: OfferingWarning | null;
}
