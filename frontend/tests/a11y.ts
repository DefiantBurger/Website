// Accessibility scan: runs axe-core on every route, in both themes, at desktop
// and phone width, against a running dev server. Exits 1 on any violation.
//
//   ./start-dev.sh                  # from the repo root, in another terminal
//   pnpm a11y                       # scans http://localhost:5173
//   TEST_BASE_URL=https://... pnpm a11y
//
// axe catches contrast, labels, ARIA, and structure problems. It can't judge
// screen-reader flow, focus handling, or drag-and-drop; check those by hand.
import { createRequire } from 'node:module';

import type { AxeResults, ContextObject, RunOptions } from 'axe-core';
import type { Browser } from 'playwright-core';

import { BASE_URL, assertServerUp, launchBrowser, routePaths } from './browser.ts';

const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 400, height: 850 },
];

const RUN_OPTIONS: RunOptions = {
  runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
};
// Mermaid draws diagrams in its own theme colors (see KNOWN-ISSUES.md).
const AXE_CONTEXT: ContextObject = { exclude: ['.mermaid'] };
const AXE_ARGS_JSON = JSON.stringify({ axeContext: AXE_CONTEXT, options: RUN_OPTIONS });

// The page fills in after data loads, and StatusMessage fills its live region
// ~100 ms after mounting, so give each page a moment after the network settles.
const SETTLE_MS = 500;

type Finding = { scan: string; path: string; violation: AxeResults['violations'][number] };

async function scan(
  browser: Browser,
  theme: string,
  viewport: (typeof VIEWPORTS)[number],
  paths: string[],
) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((value) => localStorage.setItem('theme', value), theme);
  const page = await context.newPage();
  const findings: Finding[] = [];

  for (const path of paths) {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(SETTLE_MS);
    await page.addScriptTag({ path: AXE_PATH });
    // Options go over as a JSON string: Playwright infers a serialized type for
    // structured arguments, and axe's option types are too deep for that.
    const results = await page.evaluate<AxeResults, string>((argsJson) => {
      // Typed, or `any` would select axe.run's callback overload (returns void).
      const { axeContext, options } = JSON.parse(argsJson) as {
        axeContext: ContextObject;
        options: RunOptions;
      };
      return (globalThis as unknown as { axe: typeof import('axe-core') }).axe.run(
        axeContext,
        options,
      );
    }, AXE_ARGS_JSON);
    for (const violation of results.violations) {
      findings.push({ scan: `${theme}/${viewport.name}`, path, violation });
    }
  }

  await context.close();
  return findings;
}

async function main(): Promise<void> {
  await assertServerUp();
  const browser = await launchBrowser();

  try {
    const setup = await browser.newContext();
    const paths = await routePaths(setup);
    await setup.close();

    const scans = THEMES.flatMap((theme) =>
      VIEWPORTS.map((viewport) => scan(browser, theme, viewport, paths)),
    );
    const findings = (await Promise.all(scans)).flat();

    console.log(
      `Scanned ${paths.length} routes × ${THEMES.length} themes × ${VIEWPORTS.length} widths.`,
    );
    if (findings.length === 0) {
      console.log('No accessibility violations.');
      return;
    }

    for (const { scan: scanName, path, violation } of findings) {
      console.log(`\n[${violation.impact ?? 'unknown'}] ${violation.id} on ${path} (${scanName})`);
      console.log(`  ${violation.help}: ${violation.helpUrl}`);
      for (const node of violation.nodes.slice(0, 3)) {
        console.log(`  - ${node.target.join(' ')}`);
        const detail = node.any[0]?.message ?? node.all[0]?.message ?? node.none[0]?.message;
        if (detail) {
          console.log(`    ${detail}`);
        }
      }
      if (violation.nodes.length > 3) {
        console.log(`  ...and ${violation.nodes.length - 3} more`);
      }
    }
    console.log(`\n${findings.length} violation(s).`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await main();
