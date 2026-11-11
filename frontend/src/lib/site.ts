// Site-wide identity, in a plain module so vite.config.ts and the build plugins can import it.

export const SITE_ORIGIN = 'https://josephcicalese.com';
export const STATUS_PAGE_URL = `https://status.${new URL(SITE_ORIGIN).host}/`;

export const OWNER_NAME = 'Joseph Cicalese';
export const EMAIL = 'joseph.cicalese@gmail.com';
export const GITHUB_URL = 'https://github.com/DefiantBurger';
export const LINKEDIN_URL = 'https://www.linkedin.com/in/joseph-cicalese/';
