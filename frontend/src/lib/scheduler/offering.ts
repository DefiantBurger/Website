// Soft warnings for courses planned in a season they're rarely or never offered in, based on
// the catalog's offering history (Fall/Spring only). History, not the official schedule, so
// these never block anything.
import { isPastSemester, parseSemesterKey } from './semesters';
import type {
  CourseCatalog,
  CourseCatalogRecord,
  OfferedSeason,
  OfferedWindow,
  OfferingWarning,
  ScheduleState,
} from './types';

const SEASON_OF_TERM: Partial<Record<string, OfferedSeason>> = { fall: 'Fall', spring: 'Spring' };
const OTHER_SEASON: Record<OfferedSeason, OfferedSeason> = { Fall: 'Spring', Spring: 'Fall' };

// Relative, not absolute: a course offered in half of each season (often a new one) is equally
// likely either way, so only a season much weaker than the other is worth a warning.
const RARE_RELATIVE_RATE = 0.5;

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** The file's `offered_window`, or null when it's missing or malformed (no warnings then). */
export function parseOfferedWindow(value: unknown): OfferedWindow | null {
  const window = value as Partial<OfferedWindow> | null | undefined;
  if (
    !window ||
    typeof window.from !== 'string' ||
    typeof window.to !== 'string' ||
    !isCount(window.Fall) ||
    !isCount(window.Spring) ||
    window.Fall === 0 ||
    window.Spring === 0
  ) {
    return null;
  }
  return { from: window.from, to: window.to, Fall: window.Fall, Spring: window.Spring };
}

/** Per-season counts, or null when the course has no offering in the window (unknown, not "never"). */
function offeringCounts(
  record: CourseCatalogRecord | undefined,
): Record<OfferedSeason, number> | null {
  const times = record?.times_offered;
  if (!times || !isCount(times.Fall) || !isCount(times.Spring) || times.Fall + times.Spring === 0) {
    return null;
  }
  return times;
}

/** Warning for taking a course in `termKey`'s season; null for winter, summer, and precollege. */
export function offeringWarning(
  record: CourseCatalogRecord | undefined,
  window: OfferedWindow | null,
  termKey: string,
): OfferingWarning | null {
  const season = SEASON_OF_TERM[parseSemesterKey(termKey)?.term ?? ''];
  const times = offeringCounts(record);
  if (!season || !times || !window) {
    return null;
  }
  const other = OTHER_SEASON[season];
  const count = Math.min(times[season], window[season]);
  const rate = count / window[season];
  const otherRate = Math.min(times[other], window[other]) / window[other];
  const kind = count === 0 ? 'not-offered' : rate < otherRate * RARE_RELATIVE_RATE ? 'rare' : null;
  return kind ? { kind, season, count, outOf: window[season] } : null;
}

/** Warnings by course ID, skipping past terms: a course already taken was clearly offered. */
export function findOfferingWarnings(
  catalog: CourseCatalog,
  window: OfferedWindow | null,
  schedule: ScheduleState,
  today = new Date(),
): Record<string, OfferingWarning> {
  const warnings: Record<string, OfferingWarning> = {};
  if (!window) {
    return warnings;
  }
  for (const course of Object.values(schedule.coursesById)) {
    if (isPastSemester(course.semester, today)) {
      continue;
    }
    const record = Object.hasOwn(catalog, course.name) ? catalog[course.name] : undefined;
    const warning = offeringWarning(record, window, course.semester);
    if (warning) {
      warnings[course.id] = warning;
    }
  }
  return warnings;
}

/** "offered in only 1 of the last 6 Falls" / "not offered in any of the last 5 Springs". */
export function describeOfferingWarning({ kind, season, count, outOf }: OfferingWarning): string {
  return kind === 'not-offered'
    ? `not offered in any of the last ${outOf} ${season}s`
    : `offered in only ${count} of the last ${outOf} ${season}s`;
}

/** "Fall 6 of 6, Spring 5 of 5"; null when there's no history to show. */
export function offeringSummary(
  record: CourseCatalogRecord | undefined,
  window: OfferedWindow | null,
): string | null {
  const times = offeringCounts(record);
  if (!window) {
    return null;
  }
  if (!times) {
    return 'no Fall or Spring offerings on record';
  }
  return (['Fall', 'Spring'] as const)
    .map((season) => `${season} ${Math.min(times[season], window[season])} of ${window[season]}`)
    .join(', ');
}
