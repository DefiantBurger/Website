// `?url` emits the 3 MB catalog as a hashed asset (cached forever, precompressed for
// Nginx) instead of inlining it into a JS chunk. The default plan is small enough to bundle.
import courseDataUrl from '../../content/scheduler/course_data.json?url';
import defaultSchedule from '../../content/scheduler/my_courses.json';
import { fetchWithTimeout } from '../fetchTimeout';
import { buildSchedule, parseCatalogFile, parseScheduleFile } from './catalog';
import type { CourseCatalog, OfferedWindow, ScheduleState } from './types';

/** Fetch the course catalog and expand the default schedule into course instances. */
export async function loadSchedulerData(): Promise<{
  catalog: CourseCatalog;
  offeredWindow: OfferedWindow | null;
  schedule: ScheduleState;
}> {
  const response = await fetchWithTimeout(courseDataUrl);
  if (!response.ok) {
    throw new Error(`Couldn't load the course catalog (${response.status}).`);
  }
  const { catalog, offeredWindow } = parseCatalogFile(await response.json());

  return {
    catalog,
    offeredWindow,
    schedule: buildSchedule(catalog, parseScheduleFile(defaultSchedule)),
  };
}
