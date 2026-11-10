// Project write-ups are rendered at build time by plugins/projects.ts.
import { loaders, projects } from 'virtual:projects';
import type { ProjectDetail } from './types';

export { projects };

export function hasProject(slug: string): boolean {
  // hasOwn so slugs like "constructor" don't hit Object.prototype.
  return Object.hasOwn(loaders, slug);
}

/** One project's rendered page, loaded as its own chunk. */
export async function loadProject(slug: string): Promise<ProjectDetail> {
  if (!hasProject(slug)) {
    throw new Error('Project not found.');
  }
  return (await loaders[slug]()).default;
}
