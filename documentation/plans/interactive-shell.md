# Plan: Interactive Shell

Implements the *Interactive shell* entry in [IDEAS.md](../IDEAS.md). Read `CLAUDE.md` and the *Frontend* section of [IMPLEMENTATION.md](../IMPLEMENTATION.md) first. This plan is exact on purpose: follow the file layout, names, and signatures below. When the feature ships, delete this file and the IDEAS.md entry.

**Code budget (keep it concise):** about 70 lines for `filesystem.ts`, 240 for `commands.ts`, 100 for `shell.svelte.ts`, 160 for `Shell.svelte` (styles included), 160 for the test file. Comments say *why*, one line each. No new dependencies. No abstractions beyond what's written here.

## Behavior

- A panel docked to the bottom of the viewport, over every page. The page stays visible and usable, so `cd` changes the page underneath while the shell stays open. It is **not modal**: no focus trap, no backdrop.
- Open with `` ` `` or `/` from anywhere that isn't a text field, or with a `>_` button in the nav. Close with `Esc` (from the input), `exit`, or the nav button. Closing returns focus to the element that was focused when it opened.
- Output and history live for the browser session: closing and reopening keeps the scrollback.
- The virtual filesystem is one entry per page. Static pages come from `routeDefinitions`; project pages come from the published project list. A page with sub-pages (`/projects`, `/utilities`) shows as a directory (`projects/`), but every entry is a page, so `cd` works on files and directories alike.

Commands (the words after the command name are joined with single spaces into one argument, so `grep` can take a phrase):

| Command | Does | Errors |
| --- | --- | --- |
| `help` | One line per command: `usage` padded to 20 columns, then description | |
| `ls [path]` | Direct children of a path on one line, two spaces apart, sorted, directories with a trailing `/`. A page without children prints its own name | `ls: no such file or directory: <arg>` |
| `cd [path]` | Navigates. Supports `..`, `.`, `~`, relative and absolute. No argument means `~` (home, `/`) | `cd: no such file or directory: <arg>` |
| `pwd` | The router's current path | |
| `cat <page>` | Title, description, then `demo: <url>` / `repo: <url>` lines for a project | `cat: missing operand`, `cat: no such file or directory: <arg>` |
| `open <slug>` | Opens a project's demo, or its repo if there is no demo, in a new tab. Resolves the argument as a path first, then as `/projects/<arg>` | `open: missing operand`, `open: nothing to open for <arg>` |
| `grep <term>` | Case-insensitive search of every project write-up (title, summary, and body text). One line per match: `<path>: <excerpt>`, the excerpt being up to 120 characters around the first match in that block | `grep: missing operand`, `grep: no matches for <term>` |
| `whoami` | A short version of About You: IP, city/region/country, browser, platform, timezone, pages viewed this visit, then `See /about-you for everything.` Server facts are skipped when the API call fails | |
| `theme [light\|dark]` | Toggle, or set. Prints `theme: <value>` | `theme: expected light or dark` |
| `clear` | Empties the output | |
| `history` | Numbered list of commands run this session | |
| `exit` | Closes the panel | |
| anything else | | `command not found: <name>`, with ` (did you mean <cmd>?)` when `suggestPath` finds one |

Keys inside the input: `Enter` runs, `Tab` completes (command names, or the path argument), `ArrowUp`/`ArrowDown` walk the history (the draft being typed is restored at the end), `Esc` closes.

## Files

New:

| File | Role |
| --- | --- |
| `frontend/src/lib/shell/filesystem.ts` | Pure. `ShellEntry`, `buildFilesystem`, `resolvePath`, `find`, `children`, `displayName`. |
| `frontend/src/lib/shell/commands.ts` | Pure. `ShellHost`, the command table, `runCommand`, `complete`. |
| `frontend/src/lib/shell/shell.svelte.ts` | Reactive state (`isOpen`, `lines`, `history`) and the bridge to the router, theme, and projects. |
| `frontend/src/lib/components/Shell.svelte` | The panel: log, input, hotkeys. Always mounted; renders nothing while closed. |
| `frontend/tests/unit/shell.test.ts` | `node:test` coverage of the two pure modules. |

Edited: `App.svelte`, `Nav.svelte`, `theme.svelte.ts`, `app.css`, `tests/smoke.ts`, `tests/a11y.ts`, `documentation/IMPLEMENTATION.md`, `documentation/ARCHITECTURE.md`, `documentation/IDEAS.md`.

Rule that makes the tests possible: `filesystem.ts` and `commands.ts` import nothing from `.svelte.ts` files (type-only imports are fine), nothing from `virtual:projects`, and touch no DOM or network. That is why `buildFilesystem` takes the project list as a parameter, and why `grep` and `whoami` get their data through two async `ShellHost` methods (`pageLines`, `visitor`) that the store implements. Commands may be async: `run` returns `string[] | Promise<string[]>`.

## `lib/shell/filesystem.ts`

```ts
// The shell's virtual filesystem: one entry per page, built from the route
// table and the published projects so new pages show up without extra work.
import type { ProjectSummary } from '../projects/types';
import { pathFor, routeDefinitions, SITE_NAME, type RouteDefinition } from '../routeDefinitions';

export type ShellEntry = {
  // Canonical route path. Parent/child is by path prefix, so there is no tree.
  path: string;
  title: string;
  description: string;
  // What `open` opens, preferred link first. Empty for non-project pages.
  links: { label: string; url: string }[];
  // Set for project pages, whose write-up `grep` loads on demand.
  slug?: string;
};

export function buildFilesystem(projects: ProjectSummary[]): ShellEntry[] {
  // Param routes (project pages) have no meta; their entries come from `projects`.
  const pages = (Object.values(routeDefinitions) as RouteDefinition[]).flatMap(({ path, meta }) =>
    meta
      ? [{ path, title: meta.title ?? SITE_NAME, description: meta.description, links: [] }]
      : [],
  );
  const writeups = projects.map((project) => ({
    path: pathFor('projectDetail', { slug: project.slug }),
    slug: project.slug,
    title: project.title,
    description: project.summary,
    links: [
      { label: 'demo', url: project.demo },
      { label: 'repo', url: project.repo },
    ].filter((link) => link.url),
  }));
  return [...pages, ...writeups];
}

/** `input` resolved against `cwd`: handles `/`, `~`, `.`, `..`, and extra slashes. */
export function resolvePath(cwd: string, input: string): string {
  const absolute = input.startsWith('/') || input.startsWith('~');
  const parts: string[] = [];
  for (const segment of `${absolute ? '' : cwd}/${input.replace(/^~/, '')}`.split('/')) {
    if (segment === '..') {
      parts.pop();
    } else if (segment && segment !== '.') {
      parts.push(segment);
    }
  }
  return `/${parts.join('/')}`;
}

export function find(fs: ShellEntry[], path: string): ShellEntry | undefined {
  return fs.find((entry) => entry.path === path);
}

/** Direct children of `dir`, sorted by path. */
export function children(fs: ShellEntry[], dir: string): ShellEntry[] {
  const prefix = dir === '/' ? '/' : `${dir}/`;
  return fs
    .filter(
      (entry) =>
        entry.path !== '/' &&
        entry.path.startsWith(prefix) &&
        !entry.path.slice(prefix.length).includes('/'),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Last path segment, with a trailing slash when the entry has children. */
export function displayName(fs: ShellEntry[], entry: ShellEntry): string {
  const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
  return children(fs, entry.path).length > 0 ? `${name}/` : name;
}
```

## `lib/shell/commands.ts`

Errors are thrown as plain `Error`s; the store turns the message into an error line. That keeps every command a short function returning its output lines.

```ts
// Shell commands as pure functions over a ShellHost, so node:test can run
// them against a fake host. A command throws to report an error.
import {
  browserFacts,
  deviceFacts,
  preferenceFacts,
  serverFacts,
  visitFacts,
  type BrowserInfo,
  type RequestContextSnapshot,
} from '../aboutYou/facts';
import type { InteractionState } from '../aboutYou/interactionStore';
import { pathFor } from '../routeDefinitions';
import { suggestPath } from '../routeMatching';
import type { Theme } from '../theme.svelte';
import { children, displayName, find, resolvePath, type ShellEntry } from './filesystem';

/** What About You knows about the visitor; `context` is null when the API call failed. */
export type Visitor = {
  context: RequestContextSnapshot | null;
  browser: BrowserInfo;
  visit: InteractionState;
};

/** Everything a command may read or do; shell.svelte.ts builds the real one. */
export type ShellHost = {
  fs: ShellEntry[];
  cwd: string;
  theme: Theme;
  history: readonly string[];
  navigate: (path: string) => void;
  setTheme: (theme: Theme) => void;
  openUrl: (url: string) => void;
  clear: () => void;
  close: () => void;
  /** A write-up's searchable text, one block (paragraph, heading, list item) per line. */
  pageLines: (slug: string) => Promise<string[]>;
  visitor: () => Promise<Visitor>;
};

type Command = {
  usage: string;
  description: string;
  run: (arg: string | undefined, host: ShellHost) => string[] | Promise<string[]>;
};

/** Up to 120 characters of `line` around the first `term` (already lower-cased). */
function excerpt(line: string, term: string): string {
  const start = Math.max(0, line.toLowerCase().indexOf(term) - 40);
  const text = line.slice(start, start + 120);
  return `${start > 0 ? '…' : ''}${text}${start + 120 < line.length ? '…' : ''}`;
}

// Fact labels from lib/aboutYou/facts.ts; `Timezone` matches the server's copy first.
const WHOAMI_LABELS = [
  'IP Address',
  'City',
  'Region',
  'Country',
  'Browser',
  'Platform',
  'Timezone',
  'Pages Viewed',
];

function required(command: string, arg: string | undefined): string {
  if (!arg) {
    throw new Error(`${command}: missing operand`);
  }
  return arg;
}

function lookup(command: string, arg: string, host: ShellHost): ShellEntry {
  const entry = find(host.fs, resolvePath(host.cwd, arg));
  if (!entry) {
    throw new Error(`${command}: no such file or directory: ${arg}`);
  }
  return entry;
}

export const commands: Record<string, Command> = {
  help: {
    usage: 'help',
    description: 'List commands',
    run: () =>
      Object.values(commands).map((command) => `${command.usage.padEnd(20)}${command.description}`),
  },
  ls: {
    usage: 'ls [path]',
    description: 'List pages',
    run: (arg = '', host) => {
      const entry = lookup('ls', arg, host);
      const listed = children(host.fs, entry.path);
      return [
        (listed.length > 0 ? listed : [entry]).map((e) => displayName(host.fs, e)).join('  '),
      ];
    },
  },
  cd: {
    usage: 'cd [path]',
    description: 'Go to a page (.., ~, relative or absolute)',
    run: (arg = '~', host) => {
      host.navigate(lookup('cd', arg, host).path);
      return [];
    },
  },
  pwd: { usage: 'pwd', description: 'Print the current path', run: (_arg, host) => [host.cwd] },
  cat: {
    usage: 'cat <page>',
    description: 'Describe a page',
    run: (arg, host) => {
      const entry = lookup('cat', required('cat', arg), host);
      return [entry.title, entry.description, ...entry.links.map((l) => `${l.label}: ${l.url}`)];
    },
  },
  open: {
    usage: 'open <slug>',
    description: "Open a project's demo or repository",
    run: (arg, host) => {
      const name = required('open', arg);
      const entry =
        find(host.fs, resolvePath(host.cwd, name)) ??
        find(host.fs, pathFor('projectDetail', { slug: name }));
      const link = entry?.links[0];
      if (!link) {
        throw new Error(`open: nothing to open for ${name}`);
      }
      host.openUrl(link.url);
      return [`Opening ${link.url}`];
    },
  },
  grep: {
    usage: 'grep <term>',
    description: 'Search the project write-ups',
    run: async (arg, host) => {
      const term = required('grep', arg).toLowerCase();
      const matches: string[] = [];
      for (const entry of host.fs) {
        if (!entry.slug) {
          continue;
        }
        for (const line of await host.pageLines(entry.slug)) {
          if (line.toLowerCase().includes(term)) {
            matches.push(`${entry.path}: ${excerpt(line, term)}`);
          }
        }
      }
      if (matches.length === 0) {
        throw new Error(`grep: no matches for ${arg}`);
      }
      return matches;
    },
  },
  whoami: {
    usage: 'whoami',
    description: 'What this site can tell about you',
    run: async (_arg, host) => {
      const { context, browser, visit } = await host.visitor();
      const facts = [
        ...(context ? serverFacts(context) : []),
        ...deviceFacts(browser),
        ...browserFacts(browser),
        ...preferenceFacts(browser),
        ...visitFacts(browser, visit),
      ];
      const lines = WHOAMI_LABELS.flatMap((label) => {
        const match = facts.find((fact) => fact.label === label);
        return match ? [`${label.padEnd(14)}${match.value}`] : [];
      });
      return [...lines, `See ${pathFor('aboutYou')} for everything.`];
    },
  },
  theme: {
    usage: 'theme [light|dark]',
    description: 'Toggle or set the theme',
    run: (arg, host) => {
      const next = arg ?? (host.theme === 'dark' ? 'light' : 'dark');
      if (next !== 'light' && next !== 'dark') {
        throw new Error('theme: expected light or dark');
      }
      host.setTheme(next);
      return [`theme: ${next}`];
    },
  },
  clear: {
    usage: 'clear',
    description: 'Clear the output',
    run: (_arg, host) => {
      host.clear();
      return [];
    },
  },
  history: {
    usage: 'history',
    description: 'Show the commands run this session',
    run: (_arg, host) => host.history.map((c, i) => `${String(i + 1).padStart(3)}  ${c}`),
  },
  exit: {
    usage: 'exit',
    description: 'Close the shell',
    run: (_arg, host) => {
      host.close();
      return [];
    },
  },
};

/** Runs one input line and resolves to its output lines; rejects on any error. */
export async function runCommand(input: string, host: ShellHost): Promise<string[]> {
  const [name, ...rest] = input.trim().split(/\s+/);
  // hasOwn so `constructor` doesn't hit Object.prototype.
  if (!Object.hasOwn(commands, name)) {
    const suggestion = suggestPath(name, Object.keys(commands));
    throw new Error(
      `command not found: ${name}${suggestion ? ` (did you mean ${suggestion}?)` : ''}`,
    );
  }
  return commands[name].run(rest.join(' ') || undefined, host);
}

export type Completion = { input: string; candidates: string[] };

/** Tab completion for the command name, or for its path argument. */
export function complete(input: string, host: ShellHost): Completion {
  const space = input.indexOf(' ');
  if (space < 0) {
    return pick(input, Object.keys(commands), (text) => text);
  }
  const arg = input.slice(space + 1).trimStart();
  const dir = arg.slice(0, arg.lastIndexOf('/') + 1);
  const names = children(host.fs, resolvePath(host.cwd, dir)).map((e) => displayName(host.fs, e));
  return pick(arg.slice(dir.length), names, (text) => `${input.slice(0, space + 1)}${dir}${text}`);
}

/** A unique match completes it (plus a space unless it's a directory); several fill the common prefix. */
function pick(partial: string, options: string[], replace: (text: string) => string): Completion {
  const candidates = options.filter((option) => option.startsWith(partial));
  const unique = candidates.length === 1;
  const text = unique ? candidates[0] : commonPrefix(candidates) || partial;
  return {
    input: replace(unique && !text.endsWith('/') ? `${text} ` : text),
    candidates: unique ? [] : candidates,
  };
}

function commonPrefix(strings: string[]): string {
  let prefix = strings[0] ?? '';
  for (const s of strings) {
    while (!s.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }
  return prefix;
}
```

## `lib/shell/shell.svelte.ts`

```ts
// Shell state shared by the panel, the nav button, and the hotkey. Lines and
// history survive closing the panel, so they live here, not in the component.
import { loadRequestContextSnapshot } from '../aboutYou/api';
import { readBrowser } from '../aboutYou/browser';
import { getInteractionSnapshot } from '../aboutYou/interactionStore';
import { loadProject, projects } from '../projects/content';
import { navigate, router } from '../router.svelte';
import { theme } from '../theme.svelte';
import { complete, runCommand, type ShellHost } from './commands';
import { buildFilesystem } from './filesystem';

export type ShellLine = { text: string; kind: 'input' | 'output' | 'error' };

/** A write-up's title and summary, then each block of its body as its own line. */
async function pageLines(slug: string): Promise<string[]> {
  const project = await loadProject(slug);
  const doc = new DOMParser().parseFromString(project.html, 'text/html');
  const blocks = doc.querySelectorAll('h1, h2, h3, h4, p, li, pre, td');
  const text = Array.from(blocks, (block) => block.textContent?.trim() ?? '');
  return [project.title, project.summary, ...text];
}

class ShellState {
  isOpen = $state(false);
  lines = $state<ShellLine[]>([{ text: 'Type help for commands.', kind: 'output' }]);
  history = $state<string[]>([]);
  #fs = buildFilesystem(projects);
  // Focus goes back here on close.
  #opener: Element | null = null;

  #host(): ShellHost {
    return {
      fs: this.#fs,
      cwd: router.path,
      theme: theme.current,
      history: this.history,
      navigate,
      setTheme: (value) => theme.set(value),
      openUrl: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
      clear: () => (this.lines = []),
      close: () => this.close(),
      pageLines,
      visitor: async () => ({
        context: await loadRequestContextSnapshot().catch(() => null),
        browser: readBrowser(),
        visit: getInteractionSnapshot(),
      }),
    };
  }

  open(): void {
    this.#opener = document.activeElement;
    this.isOpen = true;
  }

  close(): void {
    this.isOpen = false;
    if (this.#opener instanceof HTMLElement && this.#opener.isConnected) {
      this.#opener.focus();
    }
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /** Echoes `input`, runs it, and appends its output or error. */
  async submit(input: string): Promise<void> {
    this.lines.push({ text: input, kind: 'input' });
    const command = input.trim();
    if (!command) {
      return;
    }
    this.history.push(command);
    try {
      for (const text of await runCommand(command, this.#host())) {
        this.lines.push({ text, kind: 'output' });
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.lines.push({ text, kind: 'error' });
    }
  }

  /** The completed input; several candidates are also printed, like a real shell. */
  complete(input: string): string {
    const result = complete(input, this.#host());
    if (result.candidates.length > 0) {
      this.lines.push({ text: result.candidates.join('  '), kind: 'output' });
    }
    return result.input;
  }
}

export const shell = new ShellState();
```

Notes:

- `clear` is run from inside `submit`, after the echo line was pushed, so it wipes the echo too. That's the real `clear` behavior; don't "fix" it.
- `window.open` with `noopener,noreferrer` matches `ExternalLink.svelte`'s `rel`. It runs inside an `Enter` keydown, so it counts as a user gesture and popup blockers allow it.
- `pageLines` lists the block elements `renderMarkdown.ts` produces, so a `grep` hit reports its paragraph, not the whole write-up. A loose list (`li > p`) reports a paragraph twice; that's fine. Project chunks are cached by the browser after the first `grep`. `grep` deliberately covers only write-ups: the static pages' text is inside Svelte components, and duplicating it as data isn't worth it.
- `submit` is async only for `grep` and `whoami`. The input isn't disabled while a command runs: both finish in well under a second and nothing else depends on ordering.

## `lib/components/Shell.svelte`

Always mounted (from `App.svelte`); owns the global hotkey and renders the panel only while open.

Script:

```ts
import { shell } from '../shell/shell.svelte';

let input = $state('');
// Position in shell.history while using the arrow keys; `draft` holds what was being typed.
let historyIndex = 0;
let draft = '';

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, select, textarea, [contenteditable]') !== null
  );
}

/** `/` and backtick open the shell from anywhere that isn't a text field. */
function handleWindowKeydown(event: KeyboardEvent) {
  if (shell.isOpen || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  if ((event.key === '/' || event.key === '`') && !isTextField(event.target)) {
    // Also keeps the key out of the input and stops Firefox's quick find.
    event.preventDefault();
    shell.open();
  }
}

function handleInputKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    shell.close();
  } else if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault();
    input = shell.complete(input);
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    recall(event.key === 'ArrowUp' ? -1 : 1);
  }
}

function recall(step: number) {
  const next = Math.min(Math.max(historyIndex + step, 0), shell.history.length);
  if (next === historyIndex) {
    return;
  }
  if (historyIndex === shell.history.length) {
    draft = input;
  }
  historyIndex = next;
  input = shell.history[next] ?? draft;
}

function submit(event: SubmitEvent) {
  event.preventDefault();
  // Not awaited: the store appends the output when the command finishes.
  void shell.submit(input);
  input = '';
  historyIndex = shell.history.length;
}

/** Attachment: keep the newest line in view. Reads lines.length so it re-runs per command. */
function followOutput(log: HTMLElement) {
  void shell.lines.length;
  log.scrollTop = log.scrollHeight;
}

/** Attachment: the input mounts on every open, so this focuses it each time. */
function focusOnMount(node: HTMLElement) {
  node.focus();
}
```

Markup:

```svelte
<svelte:window onkeydown={handleWindowKeydown} />

{#if shell.isOpen}
  <section class="shell" aria-label="Shell">
    <!-- tabindex: the log scrolls, so keyboard users need to be able to focus it. -->
    <div class="log" role="log" aria-label="Shell output" tabindex="0" {@attach followOutput}>
      {#each shell.lines as line, index (index)}
        <div class:prompt={line.kind === 'input'} class:error={line.kind === 'error'}>
          {line.text}
        </div>
      {/each}
    </div>
    <form class="prompt" onsubmit={submit}>
      <label for="shell-input" class="sr-only">Command</label>
      <input
        id="shell-input"
        bind:value={input}
        onkeydown={handleInputKeydown}
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="go"
        {@attach focusOnMount}
      />
    </form>
  </section>
{/if}
```

- The input only exists while the panel is open, so the `{@attach focusOnMount}` runs on every open. No `tick()` dance.
- `{#each ... (index)}`: lines are append-only (or cleared), so the index is a stable enough key.
- The `<form>` makes the phone keyboard's Go key submit. `class="prompt"` on the form draws the `> ` before the input (the global `.prompt::before` already hides it from screen readers).
- Each line is a `div`: the log's `white-space: pre-wrap` keeps `help`'s column padding.

Styles (scoped, `--color-*` only):

```css
.shell {
  position: fixed;
  inset: auto 0 0 0;
  height: var(--shell-height);
  z-index: 150; /* above the sticky nav (100), below the skip link (200) */
  display: flex;
  flex-direction: column;
  background: var(--color-bg-surface);
  border-top: 2px solid var(--color-text-primary);
  box-shadow: 0 -6px 12px var(--color-primary-opacity-10);
  font-size: 0.9rem;
}

.log {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 1rem;
  white-space: pre-wrap;
}

.error {
  color: var(--color-error);
}

form {
  display: flex;
  align-items: center;
  padding: 0.5rem 1rem;
  border-top: var(--divider);
}

input {
  flex: 1;
  min-width: 0;
  border: 0;
  padding: 0.2rem 0;
  background: transparent;
  outline-offset: 0;
}
```

Keep the global `:focus-visible` outline on the input (don't set `outline: none`); `outline-offset: 0` just keeps it inside the form row.

## Edits to existing files

**`lib/theme.svelte.ts`**: add `set(theme: Theme)` holding the body of today's `toggle()` (apply `data-theme`, try to persist), and make `toggle()` call `this.set(this.current === 'dark' ? 'light' : 'dark')`.

**`app.css`**: in `:root`, next to `--font-mono`, add `--shell-height: min(40vh, 20rem);` with a comment that `Shell.svelte` and `App.svelte` share it. It's a size, not a color, so it needs no light-theme copy.

**`App.svelte`**:

1. Import `Shell` from `./lib/components/Shell.svelte` and `shell` from `./lib/shell/shell.svelte`.
2. Render `<Shell />` right after `</main>`.
3. Give `<main>` `class:shell-open={shell.isOpen}` and add `main.shell-open { margin-bottom: var(--shell-height); }` so the end of the page can scroll above the panel.
4. In the navigation `$effect`, inside the `tick().then` callback, only call `mainElement.focus(...)` when `!shell.isOpen`; keep setting `announcement` unconditionally. The read must stay inside the `then` callback (or be wrapped in `untrack`), or the effect would re-run on every open/close and announce the title. Add a one-line comment: a `cd` from the shell must not pull focus out of its input.

**`lib/components/Nav.svelte`**: the `>_` button replaces the Status link (the owner is moving Status to a future footer). Remove the `ExternalLink` and `STATUS_PAGE_URL` imports, the `<ExternalLink class="status-link">` element, and the two `.status-link` rules. Keep `STATUS_PAGE_URL` in `site.ts`; the footer will use it. Import `shell`, and in `.nav-actions`, before the theme toggle, add

```svelte
<button type="button" class="nav-button" aria-label="Shell" aria-expanded={shell.isOpen} onclick={() => shell.toggle()}>&gt;_</button>
```

Rename the `.theme-toggle` class to `.nav-button` (CSS and the theme button) so both share one rule. `aria-label` replaces the visible `>_`, which a screen reader would read as "greater than underscore". Don't add `aria-controls`: the panel isn't in the DOM while closed and axe flags dangling ids.

**`tests/smoke.ts`**: add one check to `siteChecks`:

```ts
{
  name: 'shell opens with backtick and cd navigates',
  run: (browser) =>
    withPage(browser, async (page) => {
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await page.keyboard.press('`');
      const input = page.getByRole('textbox', { name: 'Command' });
      await input.fill('cd about');
      await input.press('Enter');
      await page.waitForURL(`${BASE_URL}/about`);
      assert.equal(await page.locator('h1').first().textContent(), 'About Me');
      await input.press('Escape');
      await input.waitFor({ state: 'detached' });
    }),
},
```

**`tests/a11y.ts`**: in `scan()`'s loop, after `page.goto(...)` and before the settle wait, open the shell on the home page so axe sees it in both themes and both viewports:

```ts
// The shell is only in the DOM while open; scan it once, on the home page.
if (path === '/') {
  await page.keyboard.press('`');
}
```

**`documentation/IMPLEMENTATION.md`**: under *Frontend*, after *Routing*, add a short `### Interactive Shell` subsection (6 to 8 lines): what it is, the hotkeys and nav button, that the filesystem is built from `routeDefinitions` plus the published projects (`lib/shell/filesystem.ts`), that commands are pure functions over a `ShellHost` (`lib/shell/commands.ts`, unit-tested with a fake host; `grep` and `whoami` get their data through the host), that state is in `lib/shell/shell.svelte.ts` and the panel in `lib/components/Shell.svelte`, and that `help` lists the commands (don't duplicate the table). Note that `grep` searches only the project write-ups (the static pages' text lives in Svelte components, not in data). In *Checks*, mention that `pnpm smoke` also opens the shell and runs `cd`, and that `pnpm a11y` scans the home page with the shell open. In *Shared Code*, the `Nav.svelte` bullet becomes "navigation, the shell button, and the theme toggle". **`ARCHITECTURE.md`**: extend the *Navigation* bullet with one sentence: the shell navigates through the same router. **`IDEAS.md`**: delete the *Interactive shell* section, and in *Footer with live site info* change "move the Status link there from the navbar" to "add the Status link there (`STATUS_PAGE_URL` in `site.ts`; it left the navbar when the shell button took its place)". **`CLAUDE.md`**: nothing. Optionally add one bullet about the shell to the feature list in `frontend/src/content/projects/personal-website-platform.md`.

## `tests/unit/shell.test.ts`

Follow `routeMatching.test.ts` for imports and style (`node:assert/strict`, `describe`/`test`; `runCommand` is async, so `await` it and use `assert.rejects`). Build the filesystem once with two fake projects, `alpha` (repo only, no demo) and `beta` (repo and demo), and a `fakeHost(cwd, theme?)` helper that returns a `ShellHost` whose `navigate`, `setTheme`, `openUrl`, `clear`, and `close` push onto a `calls: string[]` array (e.g. `calls.push(\`navigate ${path}\`)`), whose `pageLines(slug)` returns `['Alpha', 'A']` for `alpha` and `['Beta', 'B', 'Built with Svelte and a tiny router.']` for `beta`, and whose `visitor` returns a hand-written `RequestContextSnapshot` (IP `203.0.113.7`, geolocation available with city `Madison`) and `BrowserInfo` (name `Firefox 140`, os `Linux`). Cases:

- `resolvePath`: `('/', 'projects') → '/projects'`; `('/projects', '..') → '/'`; `('/', '..') → '/'`; `('/projects/alpha', '~') → '/'`; `('/x', '/about/') → '/about'`; `('/projects', './alpha') → '/projects/alpha'`; `('/about', '') → '/about'`; `('/', '~/projects//alpha') → '/projects/alpha'`.
- `children('/')` is sorted and contains `/about` and `/projects` but not `/projects/alpha`; `displayName` gives `projects/` and `about`.
- `ls` from `/` prints one line containing `projects/` and `utilities/`; `ls projects` prints `alpha  beta`; `ls about` prints `about`; `ls nope` throws `/no such file or directory: nope/`.
- `cd projects/beta` calls `navigate /projects/beta`; `cd ..` from `/projects/beta` navigates to `/projects`; `cd` alone navigates to `/`; `cd nope` throws.
- `pwd` returns `[cwd]`.
- `cat about` returns the About title and description; `cat projects/beta` includes `demo: ` before `repo: `; `cat` alone throws `/missing operand/`.
- `open beta` from `/` opens the demo (slug fallback); `open alpha` opens the repo; `open about` throws `/nothing to open/`.
- `grep svelte` returns exactly one line, starting `/projects/beta: ` and containing `Svelte`; `grep tiny router` (a phrase) matches too; `grep alpha` matches `/projects/alpha` by title; `grep zzzz` rejects `/no matches/`; `grep` alone rejects `/missing operand/`; a 400-character line is cut to a 120-character excerpt with `…` on both sides.
- `whoami` returns lines starting with `IP Address`, `City`, `Browser`, `Platform`, and a last line `See /about-you for everything.`; with `context: null` there is no `IP Address` line but `Browser` is still there.
- `theme` with no arg from `light` sets `dark` and returns `['theme: dark']`; `theme light` sets light; `theme blue` throws.
- `history` numbers the host's history; `clear` and `exit` call the host; `help` has one line per command.
- Unknown: `sl` throws a message containing `did you mean ls`; `zzzz` throws without a suggestion.
- `complete`: `'l'` → `{ input: 'ls ', candidates: [] }`; `'cd pro'` → `'cd projects/'`; `'cd projects/'` → candidates `['alpha', 'beta']` and input unchanged; `'cd projects/al'` → `'cd projects/alpha '`; `'cd a'` → input `'cd about'` with both `about` candidates; `''` → every command as a candidate; from cwd `/projects`, `'cat ../ab'` → `'cat ../about'` (two candidates).

## Order of work

1. `theme.svelte.ts` (`set`), `app.css` (`--shell-height`).
2. `filesystem.ts`, `commands.ts`, then `shell.test.ts`; run `pnpm test` until green.
3. `shell.svelte.ts`, `Shell.svelte`, then the `App.svelte` and `Nav.svelte` edits.
4. `./start-dev.sh` in the background and check with the Playwright MCP, in light and dark and at 400px width: open with `` ` ``, with `/`, and with the nav button; `/` must not appear in the input; `ls`, `cd projects`, `cd <slug>`, `cd ..`, `cat`, `open`, `grep svelte`, `whoami` (with the backend running, and once with it stopped to see the server facts drop out), `theme`, Tab completion, arrow history, `Esc` returning focus to the opener; the page bottom reachable with the panel open; typing `/` inside a scheduler or file-share input must not open the shell. Stop the dev server afterwards.
5. Smoke and a11y additions, then docs.
6. Run everything: `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm build`, then `pnpm smoke` and `pnpm a11y` (this touches the nav, the shared layout, and global key handling, so don't skip them).

Suggested commit message:

```
Added an interactive shell for navigating and searching the site
```
