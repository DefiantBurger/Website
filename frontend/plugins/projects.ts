// Build-time project content: reads the write-ups in src/content/projects/ and
// serves them to the app as virtual modules, with the Markdown already rendered.
//   virtual:projects        published summaries (highest priority first) + per-project loaders
//   virtual:project/<slug>  one project's summary and HTML (its own chunk)
import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { parse as parseYaml } from 'yaml';
import type { ProjectDetail, ProjectSummary } from '../src/lib/projects/types.ts';
import { renderProjectMarkdown } from './renderMarkdown.ts';

export interface ProjectSource extends ProjectSummary {
  priority: number;
  published: boolean;
  markdown: string;
}

const LIST_ID = 'virtual:projects';
const DETAIL_PREFIX = 'virtual:project/';
// Slugs become directory names in dist/ and chunk import paths, so keep them plain.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Split a file into (YAML frontmatter, Markdown body); files without frontmatter return ({}, text). */
export function splitFrontmatter(text: string): { meta: Record<string, unknown>; body: string } {
  const end = text.startsWith('---\n') ? text.indexOf('\n---\n', 3) : -1;
  if (end === -1) {
    return { meta: {}, body: text };
  }
  const meta: unknown = parseYaml(text.slice(4, end + 1));
  return {
    meta:
      meta && typeof meta === 'object' && !Array.isArray(meta)
        ? (meta as Record<string, unknown>)
        : {},
    body: text.slice(end + 5).replace(/^\n+/, ''),
  };
}

const titleCase = (text: string) =>
  text.replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());

/** Parse one write-up, filling defaults for missing frontmatter. */
export function parseProject(fileName: string, text: string): ProjectSource {
  const { meta, body } = splitFrontmatter(text);
  const slug = String(meta.slug || basename(fileName, '.md'));
  const priority = Number.parseInt(String(meta.priority ?? 0), 10);
  return {
    slug,
    title: String(meta.title || titleCase(slug.replace(/-/g, ' '))),
    summary: String(meta.summary || ''),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    repo: String(meta.repo || ''),
    demo: String(meta.demo || ''),
    priority: Number.isNaN(priority) ? 0 : priority,
    published: Boolean(meta.published ?? true),
    markdown: body,
  };
}

/** Published projects, highest priority first. Throws on bad or duplicate slugs so the build fails. */
export function readPublishedProjects(dir: string): ProjectSource[] {
  const projects = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => parseProject(name, readFileSync(resolve(dir, name), 'utf8')))
    .filter((project) => project.published);

  const seen = new Set<string>();
  for (const { slug } of projects) {
    if (!SLUG_PATTERN.test(slug)) {
      throw new Error(`projects: slug "${slug}" must be lowercase letters, digits, and hyphens`);
    }
    if (seen.has(slug)) {
      throw new Error(`projects: more than one published project has slug "${slug}"`);
    }
    seen.add(slug);
  }
  return projects.sort((a, b) => b.priority - a.priority || a.slug.localeCompare(b.slug));
}

const toSummary = ({ slug, title, summary, tags, repo, demo }: ProjectSource): ProjectSummary => ({
  slug,
  title,
  summary,
  tags,
  repo,
  demo,
});

export function projectsPlugin(dir: string): Plugin {
  return {
    name: 'projects',
    resolveId(id) {
      if (id === LIST_ID || id.startsWith(DETAIL_PREFIX)) {
        return `\0${id}`;
      }
    },
    async load(id) {
      if (id === `\0${LIST_ID}`) {
        const projects = readPublishedProjects(dir);
        const loaders = projects.map(
          ({ slug }) =>
            `  ${JSON.stringify(slug)}: () => import(${JSON.stringify(DETAIL_PREFIX + slug)}),`,
        );
        return [
          `export const projects = ${JSON.stringify(projects.map(toSummary))};`,
          `export const loaders = {\n${loaders.join('\n')}\n};`,
        ].join('\n');
      }
      if (id.startsWith(`\0${DETAIL_PREFIX}`)) {
        const slug = id.slice(DETAIL_PREFIX.length + 1);
        const project = readPublishedProjects(dir).find((candidate) => candidate.slug === slug);
        if (!project) {
          this.error(`projects: no published project "${slug}"`);
        }
        const html = await renderProjectMarkdown(project.markdown);
        const detail: ProjectDetail = { ...toSummary(project), html };
        return `export default ${JSON.stringify(detail)};`;
      }
    },
    configureServer(server) {
      // Virtual modules have no file on disk, so Vite can't tell when a write-up changes.
      server.watcher.add(dir);
      const reload = (file: string) => {
        if (!file.startsWith(dir) || !file.endsWith('.md')) {
          return;
        }
        const graph = server.environments.client.moduleGraph;
        for (const [id, mod] of graph.idToModuleMap) {
          if (id === `\0${LIST_ID}` || id.startsWith(`\0${DETAIL_PREFIX}`)) {
            graph.invalidateModule(mod);
          }
        }
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', reload).on('change', reload).on('unlink', reload);
    },
  };
}
