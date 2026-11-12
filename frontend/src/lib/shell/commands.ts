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
import { children, displayName, find, resolvePath, type ShellEntry } from './filesystem';

// Not imported from theme.svelte.ts: tsc for tests has no DOM types. svelte-check catches drift.
type Theme = 'dark' | 'light';

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
  /** Starts the `sudo` shatter effect (which clears and closes the shell when it ends); returns right away. */
  shatter: () => void;
};

type Command = {
  usage: string;
  description: string;
  /** Left out of `help`. */
  hidden?: boolean;
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
      Object.values(commands)
        .filter((command) => !command.hidden)
        .map((command) => `${command.usage.padEnd(20)}${command.description}`),
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
  sudo: {
    usage: 'sudo [command]',
    description: 'Run a command as root',
    hidden: true,
    run: (_arg, host) => {
      host.shatter();
      return [];
    },
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
