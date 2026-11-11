// Per-route HTML: every route gets its own copy of index.html with that page's title,
// description, canonical link, and Open Graph tags, so link previews and crawlers that
// don't run JavaScript see the right page. Nginx serves only files that exist, so
// unknown paths get a real 404 (with the SPA shell as the body).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { ProjectSummary } from '../src/lib/projects/types.ts';
import {
  NOT_FOUND_META,
  pageTitle,
  pathFor,
  SITE_NAME,
  PROJECT_FALLBACK_DESCRIPTION,
  routeDefinitions,
  type RouteDefinition,
  type RouteMeta,
} from '../src/lib/routeDefinitions.ts';

const definitions: RouteDefinition[] = Object.values(routeDefinitions);

export type PageHead = RouteMeta & {
  // Where the page is served.
  path: string;
  // Where crawlers should index it; omitted for the 404 page.
  canonicalPath?: string;
};

// index.html holds these markers; renderShell replaces them.
const HEAD_MARKER = '<!-- route-head -->';
const NOSCRIPT_MARKER = '<!-- noscript-links -->';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Every path the SPA can render, with `/projects/:slug` expanded to real slugs. */
export function pageHeads(projects: readonly ProjectSummary[]): PageHead[] {
  return definitions.flatMap((definition): PageHead[] => {
    if (definition.path === routeDefinitions.projectDetail.path) {
      return projects.map((project) => {
        const path = pathFor('projectDetail', { slug: project.slug });
        return {
          path,
          canonicalPath: path,
          title: project.title,
          description: project.summary || PROJECT_FALLBACK_DESCRIPTION,
        };
      });
    }
    const meta = definition.meta;
    if (!meta) {
      throw new Error(`route-html: no meta for ${definition.path}`);
    }
    const { path } = definition;
    // Fail loudly: without real values for the param, Nginx would 404 this route.
    if (path.includes(':')) {
      throw new Error(`route-html: don't know which paths ${path} covers`);
    }
    return [{ path, canonicalPath: path, ...meta }];
  });
}

/** The 404 page's head. It's served for every unknown path, so it claims no URL. */
export const notFoundHead: PageHead = { path: '/404', ...NOT_FOUND_META };

/** The tags that go in place of HEAD_MARKER. */
export function renderHead(page: PageHead, origin: string): string {
  const title = escapeHtml(pageTitle(page.title));
  const description = escapeHtml(page.description);
  // data-static-meta: main.ts removes these once the app renders its own.
  const tags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" data-static-meta />`,
    `<meta property="og:title" content="${escapeHtml(page.title ?? pageTitle())}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta property="og:image" content="${escapeHtml(origin)}/favicon.png" />`,
    `<meta name="twitter:card" content="summary" />`,
  ];
  if (page.canonicalPath) {
    const url = escapeHtml(origin + page.canonicalPath);
    tags.push(
      `<link rel="canonical" href="${url}" data-static-meta />`,
      `<meta property="og:url" content="${url}" />`,
    );
  }
  return tags.join('\n    ');
}

/** Links to every parameterless page, for the <noscript> list. */
export function renderNoscriptLinks(): string {
  return definitions
    .filter((definition) => !definition.path.includes(':') && definition.path !== '/')
    .map((definition) => {
      const title = definition.meta?.title ?? pageTitle();
      return `<li><a href="${escapeHtml(definition.path)}">${escapeHtml(title)}</a></li>`;
    })
    .join('\n        ');
}

/** index.html with its markers filled in for one page. */
export function renderShell(shell: string, page: PageHead, origin: string): string {
  for (const marker of [HEAD_MARKER, NOSCRIPT_MARKER]) {
    if (!shell.includes(marker)) {
      throw new Error(`route-html: index.html is missing ${marker}`);
    }
  }
  return shell
    .replace(HEAD_MARKER, () => renderHead(page, origin))
    .replace(NOSCRIPT_MARKER, () => renderNoscriptLinks());
}

/** Writes <path>/index.html for every route plus 404.html; the dev server fills in the requested page. */
export function routeHtml(origin: string, readProjects: () => ProjectSummary[]): Plugin {
  const findHead = (path: string) =>
    pageHeads(readProjects()).find((page) => page.path === path) ?? notFoundHead;
  return {
    name: 'route-html',
    transformIndexHtml(html, context) {
      // In a build, writeBundle fills the markers in once per route instead.
      if (!context.server) {
        return html;
      }
      const path = new URL(context.originalUrl ?? context.path, origin).pathname;
      return renderShell(html, findHead(path), origin);
    },
    writeBundle(options) {
      const dist = options.dir ?? resolve(import.meta.dirname, '..', 'dist');
      const shell = readFileSync(resolve(dist, 'index.html'), 'utf8');
      const files: [string, PageHead][] = [
        ...pageHeads(readProjects()).map((page): [string, PageHead] => [
          resolve(dist, `.${page.path}`, 'index.html'),
          page,
        ]),
        [resolve(dist, '404.html'), notFoundHead],
      ];
      for (const [file, page] of files) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, renderShell(shell, page, origin));
      }
    },
  };
}
