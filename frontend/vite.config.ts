import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { projectsPlugin, readPublishedProjects } from './plugins/projects.ts';
import { routeHtml } from './plugins/routeHtml.ts';
import { pathFor, staticRoutePaths } from './src/lib/routeDefinitions.ts';

const SITE_ORIGIN = 'https://josephcicalese.com';
const PROJECTS_DIR = resolve(import.meta.dirname, 'src/content/projects');

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

/** Writes dist/sitemap.xml at build time and serves /sitemap.xml from the dev server. */
function sitemap(): Plugin {
  return {
    name: 'sitemap',
    configureServer(server) {
      server.middlewares.use('/sitemap.xml', (_req, res) => {
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.end(sitemapXml());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml() });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    projectsPlugin(PROJECTS_DIR),
    sitemap(),
    routeHtml(SITE_ORIGIN, () => readPublishedProjects(PROJECTS_DIR)),
  ],
});
