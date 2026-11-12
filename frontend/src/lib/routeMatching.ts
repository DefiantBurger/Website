// Pure path helpers for router.svelte.ts, kept rune-free so unit tests can import them.

import { closest, distance } from 'fastest-levenshtein';

/** `/a/b?x#y` -> `['/a/b', '?x#y']`. */
export function splitPath(path: string): [pathname: string, suffix: string] {
  const end = path.search(/[?#]/);
  return end < 0 ? [path, ''] : [path.slice(0, end), path.slice(end)];
}

/** Drop query, hash, and trailing slashes so each route has one canonical path. */
export function normalizePath(path: string): string {
  const [pathname] = splitPath(path);
  // A leading `//` would make history.replaceState read the path as another origin.
  return pathname.replace(/^\/+/, '/').replace(/\/+$/, '') || '/';
}

/** Params for `pathname` if it matches `pattern` (`:name` segments capture), else null. */
export function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params: Record<string, string> = {};
  for (const [index, part] of patternParts.entries()) {
    if (part.startsWith(':')) {
      try {
        params[part.slice(1)] = decodeURIComponent(pathParts[index]);
      } catch {
        // Malformed escape (e.g. `%ZZ`): no match, so the 404 page renders.
        return null;
      }
    } else if (part !== pathParts[index]) {
      return null;
    }
  }
  return params;
}

/** The candidate nearest to `path`, or null when even that one is too different to be a typo. */
export function suggestPath(path: string, candidates: string[]): string | null {
  if (candidates.length === 0) {
    return null;
  }
  const suggestion = closest(path, candidates);
  // Scale with length so long paths tolerate a few typos and short ones still allow two.
  const maxDistance = Math.max(2, Math.floor(path.length * 0.4));
  return distance(path, suggestion) <= maxDistance ? suggestion : null;
}
