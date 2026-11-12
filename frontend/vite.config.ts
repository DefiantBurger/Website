import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fillTemplate, generatedFiles } from './plugins/generatedFiles.ts';
import { projectsPlugin, readPublishedProjects } from './plugins/projects.ts';
import { routeHtml } from './plugins/routeHtml.ts';
import { pathFor, staticRoutePaths } from './src/lib/routeDefinitions.ts';
import { EMAIL, SITE_ORIGIN } from './src/lib/site.ts';

const PROJECTS_DIR = resolve(import.meta.dirname, 'src/content/projects');
const SITE_FILES_DIR = resolve(import.meta.dirname, 'site-files');
const TEMPLATE_VALUES = { SITE_ORIGIN, EMAIL };

const publishedProjectPaths = () =>
  readPublishedProjects(PROJECTS_DIR).map((project) =>
    pathFor('projectDetail', { slug: project.slug }),
  );

/** Sitemap XML from the app's parameterless routes and the project files. */
function sitemapXml(): string {
  const paths = [...staticRoutePaths(), ...publishedProjectPaths()];
  const urls = paths.map((path) => `  <url><loc>${SITE_ORIGIN}${path}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

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

const siteFile = (name: string) => () =>
  fillTemplate(resolve(SITE_FILES_DIR, name), TEMPLATE_VALUES);

// https://vite.dev/config/
export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [
    svelte(),
    projectsPlugin(PROJECTS_DIR),
    generatedFiles({
      'sitemap.xml': sitemapXml,
      'robots.txt': siteFile('robots.txt'),
      '.well-known/security.txt': siteFile('security.txt'),
    }),
    routeHtml(SITE_ORIGIN, () => readPublishedProjects(PROJECTS_DIR)),
  ],
});
