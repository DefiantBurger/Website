import { apiJson } from '../api';
import { buildSchedule, parseCatalogFile, parseScheduleFile } from './catalog';
import type { CourseCatalog, ScheduleState } from './types';

/** Fetch the course catalog and the default schedule, expanded into course instances. */
export async function loadSchedulerData(): Promise<{
  catalog: CourseCatalog;
  schedule: ScheduleState;
}> {
  const [scheduleFile, catalogFile] = await Promise.all([
    apiJson<unknown>('/api/scheduler/default-schedule/'),
    apiJson<unknown>('/api/scheduler/course-data/'),
  ]);
  const catalog = parseCatalogFile(catalogFile);

  return { catalog, schedule: buildSchedule(catalog, parseScheduleFile(scheduleFile)) };
}
