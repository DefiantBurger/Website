import { errorMessage } from './api';

/** Busy, error, and success state for one async action, so pages don't hand-roll try/catch/finally. */
export class AsyncTask {
  busy = $state(false);
  error = $state<string | null>(null);
  success = $state<string | null>(null);

  // Separate from `busy`, which can start true for pages that load on mount.
  #running = false;
  readonly #fallback: string;

  /** `fallback` is the error shown when the thrown value has no message. */
  constructor(fallback: string, { busy = false }: { busy?: boolean } = {}) {
    this.#fallback = fallback;
    this.busy = busy;
  }

  /**
   * Clear the messages and run `action`; a throw becomes `error`. Ignored while
   * already running. Returns whether the action finished without throwing.
   */
  async run(action: () => Promise<void>): Promise<boolean> {
    if (this.#running) {
      return false;
    }
    this.#running = true;
    this.busy = true;
    this.reset();
    try {
      await action();
      return true;
    } catch (error) {
      this.error = errorMessage(error, this.#fallback);
      return false;
    } finally {
      this.#running = false;
      this.busy = false;
    }
  }

  /** Show `message` as the only message, e.g. for a validation failure before running. */
  fail(message: string): void {
    this.reset();
    this.error = message;
  }

  reset(): void {
    this.error = null;
    this.success = null;
  }
}
