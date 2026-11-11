// Files built from code instead of copied from public/, so values like the site origin
// live in one place. Each is served by the dev server and emitted into the build.
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/** Output path (no leading slash) to a function that builds the file's contents. */
export type GeneratedFiles = Record<string, () => string>;

const CONTENT_TYPES: Record<string, string> = {
  xml: 'application/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

/** A template file with every `%NAME%` replaced; unknown placeholders fail the build. */
export function fillTemplate(file: string, values: Record<string, string>): string {
  return readFileSync(file, 'utf8').replace(/%([A-Z_]+)%/g, (_match, name: string) => {
    if (!(name in values)) {
      throw new Error(`generated-files: ${file} uses unknown placeholder %${name}%`);
    }
    return values[name];
  });
}

export function generatedFiles(files: GeneratedFiles): Plugin {
  return {
    name: 'generated-files',
    configureServer(server) {
      for (const [path, build] of Object.entries(files)) {
        server.middlewares.use(`/${path}`, (_req, res) => {
          const extension = path.split('.').pop() ?? '';
          res.setHeader('Content-Type', CONTENT_TYPES[extension] ?? 'text/plain; charset=utf-8');
          res.end(build());
        });
      }
    },
    generateBundle() {
      for (const [fileName, build] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName, source: build() });
      }
    },
  };
}
