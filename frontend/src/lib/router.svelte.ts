// Minimal History API router: matches the route table (routes.ts) onto reactive
// state that App.svelte renders. Same-origin <a href> clicks are routed
// client-side, so pages can use plain links.
import type { Component } from 'svelte';

import { recordRouteVisit } from './aboutYou/interactionStore';

export type Route = {
  // Pattern; `:name` segments become route params. Also recorded as the
  // About You page's navigation history entry.
  path: string;
  page: Component;
  aliases?: string[];
  // Use the wide page container.
  wide?: boolean;
};

let routes: Route[] = [];
let notFoundRoute: Route;

class RouterState {
  /** Canonical pathname currently shown. */
  path = $state('/');
  route = $state.raw<Route | null>(null);
  params = $state.raw<Record<string, string>>({});
}

export const router = new RouterState();

/** Drop query, hash, and trailing slashes so each route has one canonical path. */
function normalizePath(path: string): string {
  const pathname = path.split(/[?#]/)[0];
  return pathname.replace(/\/+$/, '') || '/';
}

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params: Record<string, string> = {};
  for (const [index, part] of patternParts.entries()) {
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(pathParts[index]);
    } else if (part !== pathParts[index]) {
      return null;
    }
  }
  return params;
}

function applyRoute(pathname: string) {
  let route = notFoundRoute;
  let params: Record<string, string> = {};

  for (const candidate of routes) {
    const match = [candidate.path, ...(candidate.aliases ?? [])]
      .map((pattern) => matchPattern(pattern, pathname))
      .find((result) => result !== null);
    if (match) {
      route = candidate;
      params = match;
      break;
    }
  }

  router.path = pathname;
  router.route = route;
  router.params = params;
  recordRouteVisit(route.path);
}

function routeToCurrentLocation() {
  const { pathname, search, hash } = window.location;
  const canonicalPath = normalizePath(pathname);
  if (canonicalPath !== pathname) {
    window.history.replaceState({}, '', `${canonicalPath}${search}${hash}`);
  }

  applyRoute(canonicalPath);
}

/** Route left-clicks on same-origin links through `navigate` instead of reloading. */
function handleLinkClick(event: MouseEvent) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  const anchor = (event.target as Element | null)?.closest('a');
  if (
    !(anchor instanceof HTMLAnchorElement) ||
    (anchor.target && anchor.target !== '_self') ||
    anchor.hasAttribute('download')
  ) {
    return;
  }

  const url = new URL(anchor.href);
  if (url.origin !== window.location.origin) {
    return;
  }
  // In-page anchors (e.g. Markdown heading links) keep the browser's scrolling.
  if (url.hash && normalizePath(url.pathname) === router.path) {
    return;
  }

  event.preventDefault();
  navigate(`${url.pathname}${url.search}${url.hash}`);
}

/** Paths without params, e.g. for suggesting where a broken link meant to go. */
export function staticPaths(): string[] {
  return routes.map((route) => route.path).filter((path) => !path.includes(':'));
}

let isInitialized = false;

export function initRouter(routeTable: Route[], notFound: Route) {
  if (isInitialized) {
    return;
  }

  routes = routeTable;
  notFoundRoute = notFound;
  routeToCurrentLocation();
  window.addEventListener('popstate', routeToCurrentLocation);
  document.addEventListener('click', handleLinkClick);
  isInitialized = true;
}

/** Client-side navigation: pushes a history entry and renders the matching page. */
export function navigate(path: string) {
  const canonicalPath = normalizePath(path);
  const suffix = path.slice(path.split(/[?#]/)[0].length);

  if (window.location.pathname !== canonicalPath || window.location.search + window.location.hash !== suffix) {
    window.history.pushState({}, '', `${canonicalPath}${suffix}`);
    window.scrollTo(0, 0);
  }
  applyRoute(canonicalPath);
}
