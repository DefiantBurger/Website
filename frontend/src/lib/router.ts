import { writable } from 'svelte/store';
import page from 'page';

import Home from '../pages/Home.svelte';
import Projects from '../pages/Projects.svelte';
import ProjectDetail from '../pages/ProjectDetail.svelte';
import About from '../pages/About.svelte';
import AboutYou from '../pages/AboutYou.svelte';
import Contact from '../pages/Contact.svelte';
import Utilities from '../pages/Utilities.svelte';
import UtilityScheduler from '../pages/UtilityScheduler.svelte';
import UtilityFileShare from '../pages/UtilityFileShare.svelte';
import { recordRouteVisit } from './aboutYou/interactionStore';

export const currentPage = writable<any>(Home);
export const currentRoute = writable<string>('/');
export const routeParams = writable<Record<string, string>>({});

export function initRouter() {
  page('/', () => {
    currentPage.set(Home);
    currentRoute.set('/');
    routeParams.set({});
    recordRouteVisit('/');
  });

  page('/projects', () => {
    currentPage.set(Projects);
    currentRoute.set('/projects');
    routeParams.set({});
    recordRouteVisit('/projects');
  });

  page('/projects/:slug', (ctx) => {
    currentPage.set(ProjectDetail);
    currentRoute.set(ctx.path);
    routeParams.set({ slug: ctx.params.slug });
    recordRouteVisit('/projects/:slug');
  });

  page('/about', () => {
    currentPage.set(About);
    currentRoute.set('/about');
    routeParams.set({});
    recordRouteVisit('/about');
  });

  page('/about-you', () => {
    currentPage.set(AboutYou);
    currentRoute.set('/about-you');
    routeParams.set({});
    recordRouteVisit('/about-you');
  });

  page('/contact', () => {
    currentPage.set(Contact);
    currentRoute.set('/contact');
    routeParams.set({});
    recordRouteVisit('/contact');
  });

  page('/utilities', () => {
    currentPage.set(Utilities);
    currentRoute.set('/utilities');
    routeParams.set({});
    recordRouteVisit('/utilities');
  });

  page('/utilities/scheduler', () => {
    currentPage.set(UtilityScheduler);
    currentRoute.set('/utilities/scheduler');
    routeParams.set({});
    recordRouteVisit('/utilities/scheduler');
  });

  page('/utilities/scheduler/', () => {
    currentPage.set(UtilityScheduler);
    currentRoute.set('/utilities/scheduler/');
    routeParams.set({});
    recordRouteVisit('/utilities/scheduler/');
  });

  page('/utilities/fileshare', () => {
    currentPage.set(UtilityFileShare);
    currentRoute.set('/utilities/fileshare');
    routeParams.set({});
    recordRouteVisit('/utilities/fileshare');
  });

  page('/utilities/fileshare/', () => {
    currentPage.set(UtilityFileShare);
    currentRoute.set('/utilities/fileshare/');
    routeParams.set({});
    recordRouteVisit('/utilities/fileshare/');
  });

  page.start();
}

// Helper function for navigation
export function navigate(path: string) {
  page.show(path);
}
