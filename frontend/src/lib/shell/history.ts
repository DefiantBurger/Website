// Command history with arrow-key recall. Plain TS (not a rune file) so node:test can run it.

export class ShellHistory {
  readonly entries: string[] = [];
  // Index into entries while recalling; entries.length means "past the newest", i.e. the draft.
  #cursor = 0;
  // What was being typed before recall started, restored when stepping back past the newest.
  #draft = '';

  /** Records a command (blank ones aren't kept) and ends any recall in progress. */
  add(command: string): void {
    if (command) {
      this.entries.push(command);
    }
    this.#cursor = this.entries.length;
  }

  /** The input after stepping `step` entries (-1 older, 1 newer), or null at either end. */
  recall(step: number, input: string): string | null {
    const next = Math.min(Math.max(this.#cursor + step, 0), this.entries.length);
    if (next === this.#cursor) {
      return null;
    }
    if (this.#cursor === this.entries.length) {
      this.#draft = input;
    }
    this.#cursor = next;
    return this.entries[next] ?? this.#draft;
  }
}
