import type { ProjectDetail, ProjectSummary } from './types';

const BACKEND_BASE_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:5000';

async function parseJsonResponse<T>(response: Response, resourceName: string): Promise<T> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    const preview = (await response.text()).slice(0, 120).replace(/\s+/g, ' ');
    throw new Error(
      `Expected JSON for ${resourceName}, got '${contentType || 'unknown'}'. Response starts with: ${preview}`
    );
  }

  return (await response.json()) as T;
}

export async function loadProjects(): Promise<ProjectSummary[]> {
  const response = await fetch(`${BACKEND_BASE_URL}/api/projects`);
  if (!response.ok) {
    throw new Error('Failed to load projects.');
  }

  return parseJsonResponse<ProjectSummary[]>(response, 'projects list');
}

export async function loadProjectBySlug(slug: string): Promise<ProjectDetail> {
  const response = await fetch(`${BACKEND_BASE_URL}/api/projects/${slug}`);
  if (response.status === 404) {
    throw new Error('Project not found.');
  }
  if (!response.ok) {
    throw new Error('Failed to load project details.');
  }

  return parseJsonResponse<ProjectDetail>(response, `project ${slug}`);
}
