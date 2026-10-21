// Minimal History API router: maps paths to page components and exposes the
// result through stores that App.svelte renders.
import { writable } from 'svelte/store';

import Home from '../pages/Home.svelte';
import Projects from '../pages/Projects.svelte';
import ProjectDetail from '../pages/ProjectDetail.svelte';
import About from '../pages/About.svelte';
import AboutYou from '../pages/AboutYou.svelte';
import Contact from '../pages/Contact.svelte';
import Utilities from '../pages/Utilities.svelte';
import UtilityScheduler from '../pages/UtilityScheduler.svelte';
import UtilityFileShare from '../pages/UtilityFileShare.svelte';
import UtilityMessageBoard from '../pages/UtilityMessageBoard.svelte';
import NotFound from '../pages/NotFound.svelte';
import { recordRouteVisit } from './aboutYou/interactionStore';

export const currentPage = writable<any>(Home);
export const currentRoute = writable<string>('/');
export const routeParams = writable<Record<string, string>>({});

type RouteMatch = {
  page: any;
  params: Record<string, string>;
  // Route pattern recorded for the About You page's navigation history.
  routeVisitPath: string;
};

let isInitialized = false;

/** Drop query, hash, and trailing slashes so each route has one canonical path. */
function normalizePath(path: string): string {
  if (!path) {
    return '/';
  }

  const [rawPath] = path.split('?');
  const [pathname] = rawPath.split('#');

  if (!pathname || pathname === '') {
    return '/';
  }

  if (pathname !== '/' && pathname.endsWith('/')) {
    return pathname.replace(/\/+$/, '');
  }

  return pathname;
}

function matchRoute(pathname: string): RouteMatch {
  if (pathname === '/') {
    return { page: Home, params: {}, routeVisitPath: '/' };
  }

  if (pathname === '/projects') {
    return { page: Projects, params: {}, routeVisitPath: '/projects' };
  }

  if (pathname === '/about') {
    return { page: About, params: {}, routeVisitPath: '/about' };
  }

  if (pathname === '/about-you') {
    return { page: AboutYou, params: {}, routeVisitPath: '/about-you' };
  }

  if (pathname === '/contact') {
    return { page: Contact, params: {}, routeVisitPath: '/contact' };
  }

  if (pathname === '/utilities') {
    return { page: Utilities, params: {}, routeVisitPath: '/utilities' };
  }

  if (pathname === '/utilities/scheduler') {
    return {
      page: UtilityScheduler,
      params: {},
      routeVisitPath: '/utilities/scheduler'
    };
  }

  if (pathname === '/utilities/fileshare') {
    return {
      page: UtilityFileShare,
      params: {},
      routeVisitPath: '/utilities/fileshare'
    };
  }

  if (pathname === '/utilities/message-board' || pathname === '/utilities/messageboard') {
    return {
      page: UtilityMessageBoard,
      params: {},
      routeVisitPath: '/utilities/message-board'
    };
  }

  const projectSlugMatch = pathname.match(/^\/projects\/([^/]+)$/);
  if (projectSlugMatch) {
    return {
      page: ProjectDetail,
      params: { slug: decodeURIComponent(projectSlugMatch[1]) },
      routeVisitPath: '/projects/:slug'
    };
  }

  return { page: NotFound, params: {}, routeVisitPath: '/404' };
}

function applyRoute(pathname: string) {
  const match = matchRoute(pathname);
  currentPage.set(match.page);
  currentRoute.set(pathname);
  routeParams.set(match.params);
  recordRouteVisit(match.routeVisitPath);
}

function routeToCurrentLocation(replaceHistory: boolean) {
  const canonicalPath = normalizePath(window.location.pathname);

  if (replaceHistory && canonicalPath !== window.location.pathname) {
    const search = window.location.search ?? '';
    const hash = window.location.hash ?? '';
    window.history.replaceState({}, '', `${canonicalPath}${search}${hash}`);
  }

  applyRoute(canonicalPath);
}

function handlePopState() {
  routeToCurrentLocation(true);
}

export function initRouter() {
  if (isInitialized) {
    return;
  }

  routeToCurrentLocation(true);
  window.addEventListener('popstate', handlePopState);
  isInitialized = true;
}

/** Client-side navigation: pushes a history entry and renders the matching page. */
export function navigate(path: string) {
  const canonicalPath = normalizePath(path);

  if (window.location.pathname === canonicalPath) {
    applyRoute(canonicalPath);
    return;
  }

  window.history.pushState({}, '', canonicalPath);
  applyRoute(canonicalPath);
}
