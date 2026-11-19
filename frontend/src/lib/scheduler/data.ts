import { apiJson } from '../api';
import { buildSchedule, parseCatalogFile, parseScheduleFile } from './catalog';
import type { CourseCatalog, OfferedWindow, ScheduleState } from './types';

/** Fetch the course catalog and the default schedule, expanded into course instances. */
export async function loadSchedulerData(): Promise<{
  catalog: CourseCatalog;
  offeredWindow: OfferedWindow | null;
  schedule: ScheduleState;
}> {
  const [scheduleFile, catalogFile] = await Promise.all([
    apiJson<unknown>('/api/scheduler/default-schedule/'),
    apiJson<unknown>('/api/scheduler/course-data/'),
  ]);
  const { catalog, offeredWindow } = parseCatalogFile(catalogFile);

  return {
    catalog,
    offeredWindow,
    schedule: buildSchedule(catalog, parseScheduleFile(scheduleFile)),
  };
}
