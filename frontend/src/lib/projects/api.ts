import { ApiError, apiJson } from '../api';
import type { ProjectDetail, ProjectSummary } from './types';

export function loadProjects(): Promise<ProjectSummary[]> {
  return apiJson<ProjectSummary[]>('/api/projects/');
}

export async function loadProjectBySlug(slug: string): Promise<ProjectDetail> {
  try {
    return await apiJson<ProjectDetail>(`/api/projects/${encodeURIComponent(slug)}/`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new Error('Project not found.');
    }
    throw error;
  }
}
