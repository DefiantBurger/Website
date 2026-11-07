// Shared fetch helpers for every feature's API client.
// Without VITE_BACKEND_URL, dev talks to the local Flask server and production
// builds use the page's own origin (never the visitor's localhost).
export const BACKEND_BASE_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ??
  (import.meta.env.DEV ? 'http://localhost:5000' : '');

// Shown for non-JSON error bodies (e.g. Nginx's HTML pages), which aren't meant for users.
const STATUS_MESSAGES: Record<number, string> = {
  413: 'The upload is too large.',
  429: 'Too many requests. Please wait a moment and try again.',
  503: 'The service is temporarily unavailable. Please try again shortly.',
};

/** A non-2xx response; `message` is the backend's `{ error }` text when it sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) {
    try {
      const payload = (await response.json()) as { error?: string };
      return payload.error ?? 'Request failed.';
    } catch {
      return 'Request failed.';
    }
  }

  if (contentType.includes('text/plain')) {
    const text = (await response.text()).trim().slice(0, 160);
    if (text) {
      return text;
    }
  }

  return STATUS_MESSAGES[response.status] ?? `Request failed (${response.status}).`;
}

/** Fetch `path` from the backend, throwing an `ApiError` unless the response is 2xx. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${BACKEND_BASE_URL}${path}`, init);
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }
  return response;
}

/**
 * Like `apiFetch`, but parses the body as JSON. A non-JSON body (e.g. the dev
 * server's index.html when the backend URL is wrong) is reported explicitly.
 */
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    const preview = (await response.text()).slice(0, 120).replace(/\s+/g, ' ');
    throw new Error(
      `Expected JSON from ${path}, got '${contentType || 'unknown'}'. Response starts with: ${preview}`,
    );
  }

  return (await response.json()) as T;
}

/** Turn a caught value into a user-facing message. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
