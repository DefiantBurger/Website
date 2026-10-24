// The site's route table. Kept apart from the router so pages can import the
// router without an import cycle.
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
import type { Route } from './router.svelte';

export const routes: Route[] = [
  { path: '/', page: Home },
  { path: '/projects', page: Projects },
  { path: '/projects/:slug', page: ProjectDetail },
  { path: '/about', page: About },
  { path: '/about-you', page: AboutYou },
  { path: '/contact', page: Contact },
  { path: '/utilities', page: Utilities },
  { path: '/utilities/scheduler', page: UtilityScheduler, wide: true },
  { path: '/utilities/fileshare', page: UtilityFileShare, wide: true },
  {
    path: '/utilities/message-board',
    aliases: ['/utilities/messageboard'],
    page: UtilityMessageBoard,
    wide: true
  }
];

export const notFoundRoute: Route = { path: '/404', page: NotFound };
