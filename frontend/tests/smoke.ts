// Browser smoke test: loads every route and exercises the site-wide behavior
// (routing, navigation, theme) against a running dev server. Catches what type
// checks can't, like a page that throws on mount or an API call that 500s.
// Exits 1 if any check fails.
//
//   ./start-dev.sh                  # from the repo root, in another terminal
//   pnpm smoke                      # tests http://localhost:5173
//   TEST_BASE_URL=https://... pnpm smoke
import assert from 'node:assert/strict';

import type { Browser, Page } from 'playwright-core';

import { BASE_URL, MISSING_PATH, assertServerUp, launchBrowser, routePaths } from './browser.ts';

type Check = { name: string; run: (browser: Browser) => Promise<void> };

/** Collects uncaught exceptions, console errors, and failed backend calls while `page` is open. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 400) {
      errors.push(`HTTP ${response.status()} from ${response.url()}`);
    }
  });
  return errors;
}

async function withPage(browser: Browser, body: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext();
  try {
    await body(await context.newPage());
  } finally {
    await context.close();
  }
}

function routeCheck(path: string): Check {
  return {
    name: `renders ${path}`,
    run: (browser) =>
      withPage(browser, async (page) => {
        const errors = watchForErrors(page);
        await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' });
        const heading = (await page.locator('main h1, h1').first().textContent({ timeout: 5000 }))?.trim();
        if (path === MISSING_PATH) {
          assert.equal(heading, '404');
        } else {
          assert.ok(heading && heading !== '404', `expected a page heading, got ${JSON.stringify(heading)}`);
        }
        assert.deepEqual(errors, [], 'errors while loading');
      })
  };
}

const siteChecks: Check[] = [
  {
    name: 'nav links route client-side and back works',
    run: (browser) =>
      withPage(browser, async (page) => {
        await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
        // A full page load would wipe this marker.
        await page.evaluate(() => ((globalThis as { smokeMarker?: boolean }).smokeMarker = true));

        await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Projects' }).click();
        await page.waitForURL(`${BASE_URL}/projects`);
        assert.equal(await page.locator('h1').first().textContent(), 'Projects');

        await page.goBack();
        await page.waitForURL(`${BASE_URL}/`);
        assert.equal(
          await page.evaluate(() => (globalThis as { smokeMarker?: boolean }).smokeMarker),
          true,
          'navigation reloaded the page'
        );
      })
  },
  {
    name: 'trailing slashes redirect to the canonical path',
    run: (browser) =>
      withPage(browser, async (page) => {
        await page.goto(`${BASE_URL}/about/`, { waitUntil: 'networkidle' });
        assert.equal(new URL(page.url()).pathname, '/about');
      })
  },
  {
    name: '404 page suggests the closest route',
    run: (browser) =>
      withPage(browser, async (page) => {
        await page.goto(`${BASE_URL}/projectz`, { waitUntil: 'networkidle' });
        assert.equal(await page.getByRole('link', { name: '/projects' }).getAttribute('href'), '/projects');
      })
  },
  {
    name: 'theme toggle switches and persists across reloads',
    run: (browser) =>
      withPage(browser, async (page) => {
        const currentTheme = () => page.locator('html').getAttribute('data-theme');
        await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
        assert.equal(await currentTheme(), 'light', 'default theme');

        await page.getByRole('button', { name: 'Dark Mode' }).click();
        assert.equal(await currentTheme(), 'dark');

        await page.reload({ waitUntil: 'networkidle' });
        assert.equal(await currentTheme(), 'dark', 'theme after reload');
        await page.getByRole('button', { name: 'Light Mode' }).waitFor();
      })
  }
];

async function main(): Promise<void> {
  await assertServerUp();
  const browser = await launchBrowser();
  let failures = 0;

  try {
    const setup = await browser.newContext();
    const paths = await routePaths(setup);
    await setup.close();

    // Run sequentially: the output stays in order and the dev server isn't swamped.
    for (const check of [...paths.map(routeCheck), ...siteChecks]) {
      try {
        await check.run(browser);
        console.log(`  pass  ${check.name}`);
      } catch (error) {
        failures += 1;
        console.log(`  FAIL  ${check.name}`);
        console.log(`        ${(error instanceof Error ? error.message : String(error)).replace(/\n/g, '\n        ')}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} smoke check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
