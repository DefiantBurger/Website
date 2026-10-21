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

export interface SchedulerData {
  semesterOrder: string[];
  semesterToIndex: Record<string, number>;
  catalog: CourseCatalog;
  coursesById: Record<string, CourseInstance>;
  columnCourseIds: Record<string, string[]>;
  prereqsByCourseId: Record<string, Requirement[]>;
}

export type RequirementStatus = 'valid' | 'invalid' | 'concurrent';

export interface PrereqEdge {
  id: string;
  fromCourseId: string;
  toCourseId: string;
  requirement: Requirement;
  status: RequirementStatus;
}

export interface SchedulerGraph {
  edges: PrereqEdge[];
  requirementProgressByCourseId: Record<string, number>;
}
