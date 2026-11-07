// Loaded with `node --import` before the unit tests. Node runs TypeScript
// natively but, unlike Vite, won't resolve extensionless relative imports
// (`from './catalog'`), which the app source uses everywhere. Retry those with
// `.ts` instead of rewriting every import in src/.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
      const hasExtension = /\.[a-z]+$/i.test(specifier);
      if (
        isRelative &&
        !hasExtension &&
        (error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND'
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});
