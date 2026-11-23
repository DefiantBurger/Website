import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { constants, gzip } from 'node:zlib';
import type { Plugin } from 'vite';

const gzipAsync = promisify(gzip);
const TEXT_ASSET = /\.(js|css|json|svg)$/;

/**
 * Write `<file>.gz` next to each text asset, so Nginx's `gzip_static` sends it
 * instead of compressing on every request (at a much lower level than this).
 */
export function precompress(): Plugin {
  let assetsDir = 'assets';
  return {
    name: 'precompress',
    apply: 'build',
    configResolved(config) {
      assetsDir = config.build.assetsDir;
    },
    async writeBundle(options, bundle) {
      const outDir = options.dir!;
      const files = Object.keys(bundle).filter(
        (name) => name.startsWith(`${assetsDir}/`) && TEXT_ASSET.test(name),
      );
      await Promise.all(
        files.map(async (name) => {
          const path = join(outDir, name);
          const source = await readFile(path);
          const compressed = await gzipAsync(source, { level: constants.Z_BEST_COMPRESSION });
          // A tiny file can grow when gzipped; Nginx falls back to on-the-fly gzip for it.
          if (compressed.length < source.length) {
            await writeFile(`${path}.gz`, compressed);
          }
        }),
      );
    },
  };
}
