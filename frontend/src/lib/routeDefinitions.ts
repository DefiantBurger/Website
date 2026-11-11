// Route paths and page metadata without page components, so vite.config.ts can
// import them (for sitemap.xml) without pulling in Svelte. routes.ts pairs each
// key with its page, and TypeScript requires a page for every key. Order is match order.

export const SITE_NAME = 'JosephCicalese.com';

/** Tab title: the page's title with the site-name suffix, or just the site name. */
export const pageTitle = (title?: string) => (title ? `${title} · ${SITE_NAME}` : SITE_NAME);

/** Tab title (shown before the site-name suffix; omitted means just the site name) and meta description. */
export type RouteMeta = {
  title?: string;
  description: string;
};

export type RouteDefinition = {
  // Pattern; `:name` segments become route params.
  path: string;
  // Omitted when the page renders its own <PageMeta> (e.g. from loaded content).
  meta?: RouteMeta;
};

export const routeDefinitions = {
  home: {
    path: '/',
    meta: {
      description:
        "Joseph Cicalese's personal website: projects, write-ups, and interactive utilities.",
    },
  },
  projects: {
    path: '/projects',
    meta: { title: 'Projects', description: "A collection of projects I'm proud of." },
  },
  projectDetail: { path: '/projects/:slug' },
  about: {
    path: '/about',
    meta: { title: 'About', description: 'Learn more about the developer behind this website.' },
  },
  aboutYou: {
    path: '/about-you',
    meta: {
      title: 'About You',
      description:
        'See what your browser and requests reveal during your visit. Read-only, no analytics profile created.',
    },
  },
  contact: {
    path: '/contact',
    meta: { title: 'Contact', description: 'Get in touch with me.' },
  },
  utilities: {
    path: '/utilities',
    meta: {
      title: 'Utilities',
      description:
        'Interactive tools and experiments, including a class scheduler, file sharing utility, and message board.',
    },
  },
  scheduler: {
    path: '/utilities/scheduler',
    meta: {
      title: 'Class Scheduler',
      description:
        'Interactive semester planning with prerequisite validation, drag-and-drop course movement, and dependency visualization.',
    },
  },
  fileShare: {
    path: '/utilities/fileshare',
    meta: {
      title: 'File Share',
      description:
        'Upload a file with an access key, then retrieve it later by entering the same key before it expires.',
    },
  },
  messageBoard: {
    path: '/utilities/message-board',
    meta: {
      title: 'Message Board',
      description:
        'Post short anonymous notes that self-destruct shortly after posting. Plain text, anonymous, and gone in a minute.',
    },
  },
} as const satisfies Record<string, RouteDefinition>;

export type RouteKey = keyof typeof routeDefinitions;

export const NOT_FOUND_META: RouteMeta = {
  title: '404 - Not Found',
  description: 'The page you requested could not be found.',
};

/** Used while a project loads, or when its write-up has no summary. */
export const PROJECT_FALLBACK_DESCRIPTION = 'Explore this project in detail.';

/** Param names in a pattern, e.g. 'slug' for '/projects/:slug'. */
type ParamNames<Pattern extends string> = Pattern extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<`/${Rest}`>
  : Pattern extends `${string}:${infer Name}`
    ? Name
    : never;

type ParamsArg<Key extends RouteKey> = [
  ParamNames<(typeof routeDefinitions)[Key]['path']>,
] extends [never]
  ? []
  : [params: Record<ParamNames<(typeof routeDefinitions)[Key]['path']>, string>];

/** The path for a route, e.g. `pathFor('projectDetail', { slug })`. Params are required exactly when the pattern has them. */
export function pathFor<Key extends RouteKey>(key: Key, ...[params]: ParamsArg<Key>): string {
  const values: Record<string, string> = params ?? {};
  return routeDefinitions[key].path.replace(/:(\w+)/g, (_, name: string) => {
    if (values[name] === undefined) {
      throw new Error(`pathFor('${key}'): missing param '${name}'`);
    }
    return encodeURIComponent(values[name]);
  });
}

/** Paths without params, e.g. for the sitemap or suggesting where a broken link meant to go. */
export function staticRoutePaths(): string[] {
  return Object.values(routeDefinitions)
    .map((definition) => definition.path)
    .filter((path) => !path.includes(':'));
}
