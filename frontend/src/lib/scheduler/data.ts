import { apiJson } from '../api';
import { buildSchedule } from './catalog';
import type { CourseCatalog, ScheduleFile, ScheduleState } from './types';

/** Fetch the course catalog and the default schedule, expanded into course instances. */
export async function loadSchedulerData(): Promise<{ catalog: CourseCatalog; schedule: ScheduleState }> {
  const [scheduleFile, catalog] = await Promise.all([
    apiJson<ScheduleFile>('/api/scheduler/default-schedule/'),
    apiJson<CourseCatalog>('/api/scheduler/course-data/')
  ]);

  return { catalog, schedule: buildSchedule(catalog, scheduleFile) };
}
