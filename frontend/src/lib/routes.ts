// The site's route table: the paths in routeDefinitions.ts paired with their
// pages. Kept apart from the router so pages can import the router without an
// import cycle. To add a page, add its path there and its component here.
import type { Component } from 'svelte';

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
import { routeDefinitions, type RouteKey } from './routeDefinitions';
import type { Route } from './router.svelte';

const pages: Record<RouteKey, Component> = {
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

export const routes: Route[] = (Object.keys(routeDefinitions) as RouteKey[]).map((key) => ({
  ...routeDefinitions[key],
  page: pages[key],
}));

export const notFoundRoute: Route = { path: '/404', page: NotFound };
