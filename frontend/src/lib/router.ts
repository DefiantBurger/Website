import { writable } from 'svelte/store';
import page from 'page';

import Home from '../pages/Home.svelte';
import Projects from '../pages/Projects.svelte';
import ProjectDetail from '../pages/ProjectDetail.svelte';
import About from '../pages/About.svelte';
import Contact from '../pages/Contact.svelte';
import Utilities from '../pages/Utilities.svelte';
import UtilityScheduler from '../pages/UtilityScheduler.svelte';

export const currentPage = writable<any>(Home);
export const currentRoute = writable<string>('/');
export const routeParams = writable<Record<string, string>>({});

export function initRouter() {
  page('/', () => {
    currentPage.set(Home);
    currentRoute.set('/');
    routeParams.set({});
  });

  page('/projects', () => {
    currentPage.set(Projects);
    currentRoute.set('/projects');
    routeParams.set({});
  });

  page('/projects/:slug', (ctx) => {
    currentPage.set(ProjectDetail);
    currentRoute.set(ctx.path);
    routeParams.set({ slug: ctx.params.slug });
  });

  page('/about', () => {
    currentPage.set(About);
    currentRoute.set('/about');
    routeParams.set({});
  });

  page('/contact', () => {
    currentPage.set(Contact);
    currentRoute.set('/contact');
    routeParams.set({});
  });

  page('/utilities', () => {
    currentPage.set(Utilities);
    currentRoute.set('/utilities');
    routeParams.set({});
  });

  page('/utilities/scheduler', () => {
    currentPage.set(UtilityScheduler);
    currentRoute.set('/utilities/scheduler');
    routeParams.set({});
  });

  page('/utilities/scheduler/', () => {
    currentPage.set(UtilityScheduler);
    currentRoute.set('/utilities/scheduler/');
    routeParams.set({});
  });

  page.start();
}

// Helper function for navigation
export function navigate(path: string) {
  page.show(path);
}
