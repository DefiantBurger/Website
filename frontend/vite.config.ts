import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { projectsPlugin, readPublishedProjects } from './plugins/projects.ts';
import { routeDefinitions, staticRoutePaths } from './src/lib/routeDefinitions.ts';

const SITE_ORIGIN = 'https://josephcicalese.com';
const PROJECTS_DIR = resolve(import.meta.dirname, 'src/content/projects');

const publishedProjectSlugs = () =>
  readPublishedProjects(PROJECTS_DIR).map((project) => project.slug);

/** Sitemap XML from the app's parameterless routes and the project files. */
function sitemapXml(): string {
  const paths = [
    ...staticRoutePaths(),
    ...publishedProjectSlugs().map((slug) => `/projects/${slug}`),
  ];
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

/** Every path the SPA can render, aliases included, with `/projects/:slug` expanded to real slugs. */
function servedPaths(): string[] {
  return Object.values(routeDefinitions).flatMap((definition) => {
    const patterns = [definition.path, ...('aliases' in definition ? definition.aliases : [])];
    return patterns.flatMap((pattern) => {
      if (!pattern.includes(':')) {
        return [pattern];
      }
      if (pattern === routeDefinitions.projectDetail.path) {
        return publishedProjectSlugs().map((slug) => `/projects/${slug}`);
      }
      // Fail loudly: without real values for the param, Nginx would 404 this route.
      throw new Error(`route-files: don't know which paths ${pattern} covers`);
    });
  });
}

/**
 * Copies index.html to <path>/index.html for every route, plus 404.html. Nginx serves
 * only files that exist, so unknown paths get a real 404 (with the SPA shell as the body).
 */
function routeFiles(): Plugin {
  return {
    name: 'route-files',
    apply: 'build',
    writeBundle(options) {
      const dist = options.dir ?? resolve(import.meta.dirname, 'dist');
      const shell = resolve(dist, 'index.html');
      const targets = servedPaths()
        .filter((path) => path !== '/')
        .map((path) => resolve(dist, `.${path}`, 'index.html'));
      for (const target of [...targets, resolve(dist, '404.html')]) {
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(shell, target);
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), projectsPlugin(PROJECTS_DIR), sitemap(), routeFiles()],
});
