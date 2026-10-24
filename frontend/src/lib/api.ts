// Shared fetch helpers for every feature's API client.
export const BACKEND_BASE_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:5000';

/** A non-2xx response; `message` is the backend's `{ error }` text when it sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
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

  return (await response.text()).slice(0, 160) || 'Request failed.';
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
      `Expected JSON from ${path}, got '${contentType || 'unknown'}'. Response starts with: ${preview}`
    );
  }

  return (await response.json()) as T;
}

/** Turn a caught value into a user-facing message. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
