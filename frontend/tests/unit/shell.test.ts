import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { BrowserInfo, RequestContextSnapshot } from '../../src/lib/aboutYou/facts.ts';
import type { InteractionState } from '../../src/lib/aboutYou/interactionStore.ts';
import type { ProjectSummary } from '../../src/lib/projects/types.ts';
import {
  complete,
  runCommand,
  type ShellHost,
  type Visitor,
} from '../../src/lib/shell/commands.ts';
import {
  buildFilesystem,
  children,
  displayName,
  resolvePath,
} from '../../src/lib/shell/filesystem.ts';

const project = (slug: string, title: string, demo: string): ProjectSummary => ({
  slug,
  title,
  summary: title[0],
  tags: [],
  repo: `https://example.com/${slug}`,
  demo,
});

const fs = buildFilesystem([
  project('alpha', 'Alpha', ''),
  project('beta', 'Beta', 'https://beta.example.com'),
]);

const PAGE_LINES: Record<string, string[]> = {
  alpha: ['Alpha', 'A'],
  beta: ['Beta', 'B', 'Built with Svelte and a tiny router.'],
};

const context: RequestContextSnapshot = {
  timestamp: '2026-01-01T00:00:00Z',
  request: { method: 'GET', path: '/api/about-you/request-context/' },
  network: { clientIp: '203.0.113.7', ipSource: 'remote_addr', hasForwardedHeaders: false },
  geolocation: { available: true, city: 'Madison', region: 'Wisconsin', country: 'US' },
  headers: { userAgent: 'test', acceptLanguage: 'en', referer: '', doNotTrack: '' },
};

const browser: BrowserInfo = {
  name: 'Firefox 140',
  os: 'Linux',
  userAgent: 'test',
  brands: [],
  languages: ['en'],
  timezone: 'America/Chicago',
  screen: '1920x1080',
  viewport: '1280x720',
  pixelRatio: 1,
  touchPoints: 0,
  online: true,
  doNotTrack: '',
  cookiesEnabled: true,
  prefersDark: false,
  prefersReducedMotion: false,
  referrer: '',
};

const visit: InteractionState = {
  sessionStartedAt: '2026-01-01T00:00:00Z',
  previousRoute: null,
  currentRoute: '/',
  routeVisitCounts: { '/': 1 },
  projectViews: {},
};

function fakeHost(cwd: string, theme: 'light' | 'dark' = 'light') {
  const calls: string[] = [];
  const host: ShellHost & { calls: string[]; visitorData: Visitor } = {
    calls,
    fs,
    cwd,
    theme,
    history: ['ls', 'cd projects'],
    navigate: (path) => calls.push(`navigate ${path}`),
    setTheme: (value) => calls.push(`setTheme ${value}`),
    openUrl: (url) => calls.push(`openUrl ${url}`),
    clear: () => calls.push('clear'),
    close: () => calls.push('close'),
    pageLines: async (slug) => PAGE_LINES[slug] ?? [],
    visitorData: { context, browser, visit },
    visitor: async () => host.visitorData,
  };
  return host;
}

describe('resolvePath', () => {
  test('handles relative, absolute, home, dot, and extra slashes', () => {
    assert.equal(resolvePath('/', 'projects'), '/projects');
    assert.equal(resolvePath('/projects', '..'), '/');
    assert.equal(resolvePath('/', '..'), '/');
    assert.equal(resolvePath('/projects/alpha', '~'), '/');
    assert.equal(resolvePath('/x', '/about/'), '/about');
    assert.equal(resolvePath('/projects', './alpha'), '/projects/alpha');
    assert.equal(resolvePath('/about', ''), '/about');
    assert.equal(resolvePath('/', '~/projects//alpha'), '/projects/alpha');
  });
});

describe('filesystem', () => {
  test('children are direct and sorted; directories get a slash', () => {
    const paths = children(fs, '/').map((entry) => entry.path);
    assert.deepEqual(paths, [...paths].sort());
    assert.ok(paths.includes('/about') && paths.includes('/projects'));
    assert.ok(!paths.includes('/projects/alpha'));
    const byPath = (path: string) => fs.find((entry) => entry.path === path)!;
    assert.equal(displayName(fs, byPath('/projects')), 'projects/');
    assert.equal(displayName(fs, byPath('/about')), 'about');
  });
});

describe('commands', () => {
  test('ls', async () => {
    const [root] = await runCommand('ls', fakeHost('/'));
    assert.match(root, /projects\//);
    assert.match(root, /utilities\//);
    assert.deepEqual(await runCommand('ls projects', fakeHost('/')), ['alpha  beta']);
    assert.deepEqual(await runCommand('ls about', fakeHost('/')), ['about']);
    await assert.rejects(runCommand('ls nope', fakeHost('/')), /no such file or directory: nope/);
  });

  test('cd', async () => {
    const host = fakeHost('/');
    await runCommand('cd projects/beta', host);
    await runCommand('cd', host);
    assert.deepEqual(host.calls, ['navigate /projects/beta', 'navigate /']);
    const nested = fakeHost('/projects/beta');
    await runCommand('cd ..', nested);
    assert.deepEqual(nested.calls, ['navigate /projects']);
    await assert.rejects(runCommand('cd nope', host), /no such file or directory/);
  });

  test('pwd', async () => {
    assert.deepEqual(await runCommand('pwd', fakeHost('/about')), ['/about']);
  });

  test('cat', async () => {
    const about = fs.find((entry) => entry.path === '/about')!;
    assert.deepEqual(await runCommand('cat about', fakeHost('/')), [
      about.title,
      about.description,
    ]);
    const beta = await runCommand('cat projects/beta', fakeHost('/'));
    const demo = beta.findIndex((line) => line.startsWith('demo: '));
    assert.ok(demo >= 0 && demo < beta.findIndex((line) => line.startsWith('repo: ')));
    await assert.rejects(runCommand('cat', fakeHost('/')), /missing operand/);
  });

  test('open', async () => {
    const host = fakeHost('/');
    await runCommand('open beta', host);
    await runCommand('open alpha', host);
    assert.deepEqual(host.calls, [
      'openUrl https://beta.example.com',
      'openUrl https://example.com/alpha',
    ]);
    await assert.rejects(runCommand('open about', host), /nothing to open/);
  });

  test('grep', async () => {
    const svelte = await runCommand('grep svelte', fakeHost('/'));
    assert.equal(svelte.length, 1);
    assert.ok(svelte[0].startsWith('/projects/beta: '));
    assert.match(svelte[0], /Svelte/);
    assert.equal((await runCommand('grep tiny router', fakeHost('/'))).length, 1);
    assert.ok((await runCommand('grep alpha', fakeHost('/')))[0].startsWith('/projects/alpha: '));
    await assert.rejects(runCommand('grep zzzz', fakeHost('/')), /no matches/);
    await assert.rejects(runCommand('grep', fakeHost('/')), /missing operand/);
  });

  test('grep cuts long lines to an excerpt', async () => {
    const host = fakeHost('/');
    const long = `${'x'.repeat(200)}needle${'y'.repeat(194)}`;
    host.pageLines = async (slug) => (slug === 'alpha' ? [long] : []);
    const [line] = await runCommand('grep needle', host);
    const text = line.slice('/projects/alpha: '.length);
    assert.equal(text.length, 122);
    assert.ok(text.startsWith('…') && text.endsWith('…'));
  });

  test('whoami', async () => {
    const host = fakeHost('/');
    const lines = await runCommand('whoami', host);
    for (const label of ['IP Address', 'City', 'Browser', 'Platform']) {
      assert.ok(
        lines.some((line) => line.startsWith(label)),
        label,
      );
    }
    assert.equal(lines.at(-1), 'See /about-you for everything.');
    host.visitorData = { ...host.visitorData, context: null };
    const offline = await runCommand('whoami', host);
    assert.ok(!offline.some((line) => line.startsWith('IP Address')));
    assert.ok(offline.some((line) => line.startsWith('Browser')));
  });

  test('theme', async () => {
    const host = fakeHost('/', 'light');
    assert.deepEqual(await runCommand('theme', host), ['theme: dark']);
    await runCommand('theme light', host);
    assert.deepEqual(host.calls, ['setTheme dark', 'setTheme light']);
    await assert.rejects(runCommand('theme blue', host), /expected light or dark/);
  });

  test('history, clear, exit, help', async () => {
    const host = fakeHost('/');
    assert.deepEqual(await runCommand('history', host), ['  1  ls', '  2  cd projects']);
    await runCommand('clear', host);
    await runCommand('exit', host);
    assert.deepEqual(host.calls, ['clear', 'close']);
    const help = await runCommand('help', host);
    assert.equal(help.length, complete('', host).candidates.length);
  });

  test('unknown commands', async () => {
    await assert.rejects(runCommand('sl', fakeHost('/')), /did you mean ls/);
    await assert.rejects(runCommand('zzzz', fakeHost('/')), (error: Error) => {
      assert.equal(error.message, 'command not found: zzzz');
      return true;
    });
  });
});

describe('complete', () => {
  const host = fakeHost('/');

  test('command names', () => {
    assert.deepEqual(complete('l', host), { input: 'ls ', candidates: [] });
    assert.ok(complete('', host).candidates.includes('grep'));
  });

  test('path arguments', () => {
    assert.equal(complete('cd pro', host).input, 'cd projects/');
    assert.deepEqual(complete('cd projects/', host), {
      input: 'cd projects/',
      candidates: ['alpha', 'beta'],
    });
    assert.equal(complete('cd projects/al', host).input, 'cd projects/alpha ');
    assert.deepEqual(complete('cd a', host), {
      input: 'cd about',
      candidates: ['about', 'about-you'],
    });
    const fromProjects = complete('cat ../ab', fakeHost('/projects'));
    assert.equal(fromProjects.input, 'cat ../about');
    assert.equal(fromProjects.candidates.length, 2);
  });
});
