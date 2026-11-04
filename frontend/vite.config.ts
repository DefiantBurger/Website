import { readdirSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { staticRoutePaths } from './src/lib/routeDefinitions.ts'

const SITE_ORIGIN = 'https://josephcicalese.com'
const PROJECTS_DIR = resolve(import.meta.dirname, '../backend/app/content/projects')

/** Read one top-level scalar from a project's front matter (mirrors the backend's defaults). */
function frontMatterValue(frontMatter: string, key: string): string | undefined {
  const match = frontMatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'))
  return match?.[1].replace(/^["']|["']$/g, '')
}

/** Slugs of published projects, the same set `/api/projects/` returns. */
function publishedProjectSlugs(): string[] {
  return readdirSync(PROJECTS_DIR)
    .filter((name) => name.endsWith('.md'))
    .flatMap((name) => {
      const text = readFileSync(resolve(PROJECTS_DIR, name), 'utf8')
      const frontMatter = text.startsWith('---\n') ? (text.split('---\n', 3)[1] ?? '') : ''
      if (frontMatterValue(frontMatter, 'published') === 'false') {
        return []
      }
      return [frontMatterValue(frontMatter, 'slug') || basename(name, '.md')]
    })
    .sort()
}

/** Sitemap XML from the app's parameterless routes and the project files. */
function sitemapXml(): string {
  const paths = [...staticRoutePaths(), ...publishedProjectSlugs().map((slug) => `/projects/${slug}`)]
  const urls = paths.map((path) => `  <url><loc>${SITE_ORIGIN}${path}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

/** Writes dist/sitemap.xml at build time and serves /sitemap.xml from the dev server. */
function sitemap(): Plugin {
  return {
    name: 'sitemap',
    configureServer(server) {
      server.middlewares.use('/sitemap.xml', (_req, res) => {
        res.setHeader('Content-Type', 'application/xml; charset=utf-8')
        res.end(sitemapXml())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml() })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), sitemap()],
})
