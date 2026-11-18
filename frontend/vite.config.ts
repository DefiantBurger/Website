import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { projectsPlugin, readPublishedProjects } from './plugins/projects.ts';
import { routeHtml } from './plugins/routeHtml.ts';
import { SITE_ORIGIN } from './src/lib/site.ts';

const PROJECTS_DIR = resolve(import.meta.dirname, 'src/content/projects');

// CI sets GITHUB_SHA; local builds ask git, and a missing repo just leaves no link.
function buildSha(): string {
  if (process.env.GITHUB_SHA) {
    return process.env.GITHUB_SHA;
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [
    svelte(),
    projectsPlugin(PROJECTS_DIR),
    routeHtml(SITE_ORIGIN, () => readPublishedProjects(PROJECTS_DIR)),
  ],
});
