import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default ts.config(
  { ignores: ['dist/'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  // Last, so formatting rules that would fight Prettier stay off.
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: {
      // Build info injected by `define` in vite.config.ts.
      globals: {
        ...globals.browser,
        ...globals.node,
        __BUILD_SHA__: 'readonly',
        __BUILD_DATE__: 'readonly',
      },
    },
    rules: {
      // A leading underscore marks a deliberately unused binding.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: { parser: ts.parser, extraFileExtensions: ['.svelte'], svelteConfig },
    },
  },
);
