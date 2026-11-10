// Minimal History API router: matches the route table (routes.ts) onto reactive
// state that App.svelte renders. Same-origin <a href> clicks are routed
// client-side, so pages can use plain links.
import type { Component } from 'svelte';

import { recordRouteVisit } from './aboutYou/interactionStore';
import { routePatterns, type RouteDefinition } from './routeDefinitions';
import { matchPattern, normalizePath } from './routeMatching';

/** Layout options a page declares with `export const layout` in `<script module>`. */
export type PageLayout = {
  // Use the wide page container.
  wide?: boolean;
};

// `path` is also recorded as the About You page's navigation history entry.
export type Route = RouteDefinition & {
  page: Component;
  layout?: PageLayout;
  // Rejects params the page can't render (e.g. an unknown slug), so the 404 page shows.
  accepts?: (params: Record<string, string>) => boolean;
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

function applyRoute(pathname: string) {
  let route = notFoundRoute;
  let params: Record<string, string> = {};

  for (const candidate of routes) {
    const match = routePatterns(candidate)
      .map((pattern) => matchPattern(pattern, pathname))
      .find((result) => result !== null);
    if (match && (candidate.accepts?.(match) ?? true)) {
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

/** Back/Forward. Hash-only changes (heading anchors, #plan= links) also fire it; those keep the page. */
function handlePopState() {
  if (window.location.pathname === router.path) {
    return;
  }
  routeToCurrentLocation();
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

let isInitialized = false;

export function initRouter(routeTable: Route[], notFound: Route) {
  if (isInitialized) {
    return;
  }

  routes = routeTable;
  notFoundRoute = notFound;
  routeToCurrentLocation();
  window.addEventListener('popstate', handlePopState);
  document.addEventListener('click', handleLinkClick);
  isInitialized = true;
}

/** Client-side navigation: pushes a history entry and renders the matching page. */
export function navigate(path: string) {
  const canonicalPath = normalizePath(path);
  const suffix = path.slice(path.split(/[?#]/)[0].length);

  if (
    window.location.pathname !== canonicalPath ||
    window.location.search + window.location.hash !== suffix
  ) {
    window.history.pushState({}, '', `${canonicalPath}${suffix}`);
    window.scrollTo(0, 0);
  }
  applyRoute(canonicalPath);
}
