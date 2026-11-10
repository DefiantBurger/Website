// Kept free of `import.meta.env` so it loads in the Node unit tests.

export const DEFAULT_TIMEOUT_MS = 15_000;

export const TIMEOUT_MESSAGE = 'The server took too long to respond. Please try again.';
export const NETWORK_MESSAGE = "Couldn't reach the server. Check your connection and try again.";

export type TimedRequestInit = RequestInit & {
  /** Max wait for the response headers; `null` waits forever (e.g. large uploads). */
  timeoutMs?: number | null;
};

/**
 * `fetch` that gives up if the headers don't arrive within `timeoutMs`. The body
 * isn't timed, so a slow but live download isn't cut off. Timeouts and network
 * failures become readable messages instead of the browser's raw `TypeError`.
 */
export async function fetchWithTimeout(
  url: string,
  init: TimedRequestInit = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...rest } = init;
  const controller = new AbortController();
  let timedOut = false;

  // Not removed after the headers arrive, so the caller can still abort the body read.
  if (callerSignal?.aborted) {
    controller.abort(callerSignal.reason);
  } else {
    callerSignal?.addEventListener('abort', () => controller.abort(callerSignal.reason), {
      once: true,
    });
  }

  const timer =
    timeoutMs === null
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new Error(TIMEOUT_MESSAGE, { cause: error });
    }
    if (!callerSignal?.aborted && error instanceof TypeError) {
      throw new Error(NETWORK_MESSAGE, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
