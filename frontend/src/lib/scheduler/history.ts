// Undo/redo over immutable snapshots: each edit pushes the previous value onto `past`.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Record a new value; drops the redo branch and the oldest entry past `limit`. */
export function commit<T>(history: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (next === history.present) {
    return history;
  }
  return { past: [...history.past, history.present].slice(-limit), present: next, future: [] };
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) {
    return history;
  }
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) {
    return history;
  }
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
  };
}
