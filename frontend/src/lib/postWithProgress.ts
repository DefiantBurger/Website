// Kept free of `import.meta.env` so it loads in the Node unit tests.
import { DEFAULT_TIMEOUT_MS, NETWORK_MESSAGE, TIMEOUT_MESSAGE } from './fetchTimeout';

export const STALL_TIMEOUT_MS = 30_000;
export const STALL_MESSAGE = 'The upload stalled. Check your connection and try again.';

export interface ProgressRequestInit {
  body: XMLHttpRequestBodyInit;
  /** Bytes of the request body sent so far; `total` is 0 when the browser can't tell. */
  onProgress?: (loaded: number, total: number) => void;
  /** Max gap between progress events while the body is being sent. */
  stallMs?: number;
  /** Max wait for the response once the whole body is sent. */
  responseTimeoutMs?: number;
}

/**
 * POST `body` with XMLHttpRequest, which (unlike `fetch`) reports upload progress.
 * A large upload can take minutes, so instead of one deadline it fails only if
 * sending stalls or the response is late once sending is done. Resolves with a
 * `Response` like `fetch` would, so callers handle errors and bodies the same way.
 */
export function postWithProgress(
  url: string,
  {
    body,
    onProgress,
    stallMs = STALL_TIMEOUT_MS,
    responseTimeoutMs = DEFAULT_TIMEOUT_MS,
  }: ProgressRequestInit,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fail = (message: string) => {
      clearTimeout(timer);
      reject(new Error(message));
    };
    const failAfter = (ms: number, message: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        xhr.abort();
        fail(message);
      }, ms);
    };

    xhr.responseType = 'blob';
    // Listeners on `upload` must exist before `send`, or the browser skips progress events.
    xhr.upload.onprogress = (event) => {
      failAfter(stallMs, STALL_MESSAGE);
      onProgress?.(event.loaded, event.lengthComputable ? event.total : 0);
    };
    xhr.upload.onload = () => failAfter(responseTimeoutMs, TIMEOUT_MESSAGE);
    xhr.onerror = () => fail(NETWORK_MESSAGE);
    xhr.onload = () => {
      clearTimeout(timer);
      try {
        const headers = { 'content-type': xhr.getResponseHeader('content-type') ?? '' };
        resolve(new Response(xhr.response as Blob, { status: xhr.status, headers }));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    xhr.open('POST', url);
    failAfter(stallMs, STALL_MESSAGE);
    xhr.send(body);
  });
}
