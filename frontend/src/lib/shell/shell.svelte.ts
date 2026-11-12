// Shell state shared by the panel, the nav button, and the hotkey. Lines and
// history survive closing the panel, so they live here, not in the component.
import { loadRequestContextSnapshot } from '../aboutYou/api';
import { readBrowser } from '../aboutYou/browser';
import { getInteractionSnapshot } from '../aboutYou/interactionStore';
import { loadProject, projects } from '../projects/content';
import { navigate, router } from '../router.svelte';
import { theme } from '../theme.svelte';
import { complete, runCommand, type ShellHost } from './commands';
import { detonate } from './detonate';
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
      clear: () => this.clear(),
      close: () => this.close(),
      pageLines,
      visitor: async () => ({
        context: await loadRequestContextSnapshot().catch(() => null),
        browser: readBrowser(),
        visit: getInteractionSnapshot(),
      }),
      detonate: () => void detonate(() => this.clear()),
    };
  }

  clear(): void {
    this.lines = [];
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
