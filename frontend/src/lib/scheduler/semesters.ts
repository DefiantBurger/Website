// Semester keys: `precollege`, or a term plus a two-digit year (`fall24`, `winter25`).

/** Courses taken before college: they satisfy prerequisites and get their own column. */
export const PRECOLLEGE_SEMESTER = 'precollege';

/** Terms in calendar order within one year. */
export const TERMS = ['winter', 'spring', 'summer', 'fall'] as const;
export type Term = (typeof TERMS)[number];

const TERM_KEY = new RegExp(`^(${TERMS.join('|')})(\\d{2})$`);

// Two-digit keys only cover one century.
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2099;

export interface TermParts {
  term: Term;
  year: number;
}

/** `fall24` -> `{ term: 'fall', year: 2024 }`; null for precollege or anything malformed. */
export function parseSemesterKey(key: string): TermParts | null {
  const match = TERM_KEY.exec(key);
  return match ? { term: match[1] as Term, year: MIN_YEAR + Number(match[2]) } : null;
}

export function semesterKey({ term, year }: TermParts): string {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new Error(`Year must be between ${MIN_YEAR} and ${MAX_YEAR}.`);
  }
  return `${term}${String(year % 100).padStart(2, '0')}`;
}

export function isSemesterKey(key: string): boolean {
  return key === PRECOLLEGE_SEMESTER || parseSemesterKey(key) !== null;
}

export function formatTerm(term: Term): string {
  return `${term[0].toUpperCase()}${term.slice(1)}`;
}

/** `fall24` -> "Fall 2024". */
export function formatSemester(key: string): string {
  if (key === PRECOLLEGE_SEMESTER) {
    return 'Precollege';
  }
  const parts = parseSemesterKey(key);
  return parts ? `${formatTerm(parts.term)} ${parts.year}` : key;
}

function rank(key: string): number {
  const parts = parseSemesterKey(key);
  return parts ? parts.year * TERMS.length + TERMS.indexOf(parts.term) : -1;
}

/** Chronological order; precollege sorts first. */
export function sortSemesters(keys: string[]): string[] {
  return keys.toSorted((a, b) => rank(a) - rank(b));
}

/** The next fall or spring after `key`; winter and summer are added by hand. */
export function nextMainTerm(key: string): TermParts {
  const parts = parseSemesterKey(key);
  if (!parts) {
    throw new Error(`'${key}' is not a term key.`);
  }
  return parts.term === 'fall'
    ? { term: 'spring', year: parts.year + 1 }
    : parts.term === 'spring' || parts.term === 'summer'
      ? { term: 'fall', year: parts.year }
      : { term: 'spring', year: parts.year };
}

/** Default first semester for an empty plan: the upcoming fall or spring. */
export function upcomingMainTerm(today: Date): TermParts {
  const month = today.getMonth();
  const year = today.getFullYear();
  // By October fall is well underway, so planning starts from next spring.
  return month < 5
    ? { term: 'spring', year }
    : month < 9
      ? { term: 'fall', year }
      : { term: 'spring', year: year + 1 };
}

/** Key the add-semester form starts at, clamped to the last representable term. */
export function suggestedNextSemester(lastKey: string | undefined, today: Date): string {
  const next = lastKey ? nextMainTerm(lastKey) : upcomingMainTerm(today);
  // A shared link can end at fall99, and semesterKey throws past MAX_YEAR.
  return next.year > MAX_YEAR
    ? semesterKey({ term: 'fall', year: MAX_YEAR })
    : semesterKey({ term: next.term, year: Math.max(next.year, MIN_YEAR) });
}
