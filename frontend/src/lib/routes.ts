// The site's route table: the paths in routeDefinitions.ts paired with their
// pages. Kept apart from the router so pages can import the router without an
// import cycle. To add a page, add its path there and its component here.
// Pages are imported whole so a page's `export const layout` (in
// `<script module>`) reaches its route without being listed here.
import type { Component } from 'svelte';

import * as Home from '../pages/Home.svelte';
import * as Projects from '../pages/Projects.svelte';
import * as ProjectDetail from '../pages/ProjectDetail.svelte';
import * as About from '../pages/About.svelte';
import * as AboutYou from '../pages/AboutYou.svelte';
import * as Contact from '../pages/Contact.svelte';
import * as Utilities from '../pages/Utilities.svelte';
import * as UtilityScheduler from '../pages/UtilityScheduler.svelte';
import * as UtilityFileShare from '../pages/UtilityFileShare.svelte';
import * as UtilityMessageBoard from '../pages/UtilityMessageBoard.svelte';
import NotFound from '../pages/NotFound.svelte';
import { hasProject } from './projects/content';
import { routeDefinitions, type RouteKey } from './routeDefinitions';
import type { PageLayout, Route } from './router.svelte';

type PageModule = {
  default: Component;
  layout?: PageLayout;
};

const pages: Record<RouteKey, PageModule> = {
  home: Home,
  projects: Projects,
  projectDetail: ProjectDetail,
  about: About,
  aboutYou: AboutYou,
  contact: Contact,
  utilities: Utilities,
  scheduler: UtilityScheduler,
  fileShare: UtilityFileShare,
  messageBoard: UtilityMessageBoard,
};

const accepts: Partial<Record<RouteKey, Route['accepts']>> = {
  projectDetail: ({ slug }) => hasProject(slug),
};

export const routes: Route[] = (Object.keys(routeDefinitions) as RouteKey[]).map((key) => ({
  ...routeDefinitions[key],
  page: pages[key].default,
  layout: pages[key].layout,
  accepts: accepts[key],
}));

export const notFoundRoute: Route = {
  path: '/404',
  page: NotFound,
  meta: { title: '404 - Not Found', description: 'The page you requested could not be found.' },
};
