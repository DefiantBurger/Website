// Shared setup for the browser scripts (a11y.ts, smoke.ts): both drive Chrome
// through playwright-core against an already-running dev server.
import { chromium, type Browser, type BrowserContext } from 'playwright-core';

import { staticRoutePaths } from '../src/lib/routeDefinitions.ts';

export const BASE_URL = (process.env.TEST_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');

/** Paths that should render the 404 page: no matching route, and an unknown project slug. */
export const MISSING_PATHS = ['/test-missing-page', '/projects/test-missing-project'];

export async function launchBrowser(): Promise<Browser> {
  // Prefer an installed Chrome, so no browser download is needed.
  try {
    return await chromium.launch({ channel: 'chrome' });
  } catch {
    // Fall back to Playwright's own Chromium, if it's been installed.
  }
  try {
    return await chromium.launch();
  } catch {
    console.error(
      'No browser found. Install Google Chrome, or run: pnpm exec playwright-core install chromium',
    );
    process.exit(2);
  }
}

export async function assertServerUp(): Promise<void> {
  try {
    await fetch(BASE_URL);
  } catch {
    console.error(
      `Can't reach ${BASE_URL}. Start the site first (./start-dev.sh from the repo root).`,
    );
    process.exit(2);
  }
}

/** Static routes plus one project page and the paths that should 404. */
export async function routePaths(context: BrowserContext): Promise<string[]> {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/projects`, { waitUntil: 'networkidle' });
  const projectPath = await page
    .locator('a.stretched-link')
    .first()
    .getAttribute('href', { timeout: 5000 })
    .catch(() => null);
  await page.close();

  if (!projectPath) {
    console.warn('No project found on /projects; skipping project detail.');
  }
  return [...staticRoutePaths(), ...(projectPath ? [projectPath] : []), ...MISSING_PATHS];
}
