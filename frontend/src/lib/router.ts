import { writable } from 'svelte/store';
import page from 'page';

import Home from '../pages/Home.svelte';
import Projects from '../pages/Projects.svelte';
import About from '../pages/About.svelte';
import Contact from '../pages/Contact.svelte';
import Utilities from '../pages/Utilities.svelte';
import UtilityScheduler from '../pages/UtilityScheduler.svelte';

export const currentPage = writable<any>(Home);
export const currentRoute = writable<string>('/');

export function initRouter() {
  page('/', () => {
    currentPage.set(Home);
    currentRoute.set('/');
  });

  page('/projects', () => {
    currentPage.set(Projects);
    currentRoute.set('/projects');
  });

  page('/about', () => {
    currentPage.set(About);
    currentRoute.set('/about');
  });

  page('/contact', () => {
    currentPage.set(Contact);
    currentRoute.set('/contact');
  });

  page('/utilities', () => {
    currentPage.set(Utilities);
    currentRoute.set('/utilities');
  });

  page('/utilities/scheduler', () => {
    currentPage.set(UtilityScheduler);
    currentRoute.set('/utilities/scheduler');
  });

  page('/utilities/scheduler/', () => {
    currentPage.set(UtilityScheduler);
    currentRoute.set('/utilities/scheduler/');
  });

  page.start();
}

// Helper function for navigation
export function navigate(path: string) {
  page.show(path);
}
