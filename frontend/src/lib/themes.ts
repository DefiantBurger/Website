// Rune-free so plain modules (and node:test) can use the theme type; state is in theme.svelte.ts.
export type Theme = 'dark' | 'light';

export const isTheme = (value: unknown): value is Theme => value === 'dark' || value === 'light';
