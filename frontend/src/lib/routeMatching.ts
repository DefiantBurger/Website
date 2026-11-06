// Pure path helpers for router.svelte.ts, kept rune-free so unit tests can import them.

/** Drop query, hash, and trailing slashes so each route has one canonical path. */
export function normalizePath(path: string): string {
  const pathname = path.split(/[?#]/)[0];
  return pathname.replace(/\/+$/, '') || '/';
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
