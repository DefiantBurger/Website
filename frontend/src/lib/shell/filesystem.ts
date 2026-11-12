// The shell's virtual filesystem: one entry per page, built from the route
// table and the published projects so new pages show up without extra work.
import type { ProjectSummary } from '../projects/types';
import { pathFor, routeDefinitions, SITE_NAME, type RouteDefinition } from '../routeDefinitions';

export type ShellEntry = {
  // Canonical route path. Parent/child is by path prefix, so there is no tree.
  path: string;
  title: string;
  description: string;
  // What `open` opens, preferred link first. Empty for non-project pages.
  links: { label: string; url: string }[];
  // Set for project pages, whose write-up `grep` loads on demand.
  slug?: string;
};

export function buildFilesystem(projects: ProjectSummary[]): ShellEntry[] {
  // Param routes (project pages) have no meta; their entries come from `projects`.
  const pages = (Object.values(routeDefinitions) as RouteDefinition[]).flatMap(({ path, meta }) =>
    meta
      ? [{ path, title: meta.title ?? SITE_NAME, description: meta.description, links: [] }]
      : [],
  );
  const writeups = projects.map((project) => ({
    path: pathFor('projectDetail', { slug: project.slug }),
    slug: project.slug,
    title: project.title,
    description: project.summary,
    links: [
      { label: 'demo', url: project.demo },
      { label: 'repo', url: project.repo },
    ].filter((link) => link.url),
  }));
  return [...pages, ...writeups];
}

/** `input` resolved against `cwd`: handles `/`, `~`, `.`, `..`, and extra slashes. */
export function resolvePath(cwd: string, input: string): string {
  const absolute = input.startsWith('/') || input.startsWith('~');
  const parts: string[] = [];
  for (const segment of `${absolute ? '' : cwd}/${input.replace(/^~/, '')}`.split('/')) {
    if (segment === '..') {
      parts.pop();
    } else if (segment && segment !== '.') {
      parts.push(segment);
    }
  }
  return `/${parts.join('/')}`;
}

export function find(fs: ShellEntry[], path: string): ShellEntry | undefined {
  return fs.find((entry) => entry.path === path);
}

/** Direct children of `dir`, sorted by path. */
export function children(fs: ShellEntry[], dir: string): ShellEntry[] {
  const prefix = dir === '/' ? '/' : `${dir}/`;
  return fs
    .filter(
      (entry) =>
        entry.path !== '/' &&
        entry.path.startsWith(prefix) &&
        !entry.path.slice(prefix.length).includes('/'),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Last path segment, with a trailing slash when the entry has children. */
export function displayName(fs: ShellEntry[], entry: ShellEntry): string {
  const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
  return children(fs, entry.path).length > 0 ? `${name}/` : name;
}
