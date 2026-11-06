// Route paths and options without page components, so vite.config.ts can import
// them (for sitemap.xml) without pulling in Svelte. routes.ts pairs each key with
// its page, and TypeScript requires a page for every key. Order is match order.
export type RouteDefinition = {
  // Pattern; `:name` segments become route params.
  path: string;
  // Extra patterns that render the same page. Left out of the sitemap.
  aliases?: string[];
};

export const routeDefinitions = {
  home: { path: '/' },
  projects: { path: '/projects' },
  projectDetail: { path: '/projects/:slug' },
  about: { path: '/about' },
  aboutYou: { path: '/about-you' },
  contact: { path: '/contact' },
  utilities: { path: '/utilities' },
  scheduler: { path: '/utilities/scheduler' },
  fileShare: { path: '/utilities/fileshare' },
  messageBoard: { path: '/utilities/message-board', aliases: ['/utilities/messageboard'] },
} satisfies Record<string, RouteDefinition>;

export type RouteKey = keyof typeof routeDefinitions;

/** Paths without params, e.g. for the sitemap or suggesting where a broken link meant to go. */
export function staticRoutePaths(): string[] {
  return Object.values(routeDefinitions)
    .map((definition) => definition.path)
    .filter((path) => !path.includes(':'));
}
