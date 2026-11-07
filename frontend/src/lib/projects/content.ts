// Project write-ups are rendered at build time by plugins/projects.ts.
import { loaders, projects } from 'virtual:projects';
import type { ProjectDetail } from './types';

export { projects };

/** One project's rendered page, loaded as its own chunk. */
export async function loadProject(slug: string): Promise<ProjectDetail> {
  // hasOwn so slugs like "constructor" don't hit Object.prototype.
  if (!Object.hasOwn(loaders, slug)) {
    throw new Error('Project not found.');
  }
  return (await loaders[slug]()).default;
}
