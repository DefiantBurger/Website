export interface Requirement {
  courseChoices: string[];
  canBeConcurrent: boolean;
}

export interface CourseCatalogRecord {
  title: string;
  credits?: number;
  min_credits?: number;
  max_credits?: number;
  prereqs: string[][];
  concurrent_prereqs: string[][];
}

export interface ScheduleFile {
  semesters: Record<string, string[]>;
}

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
