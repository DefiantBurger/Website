import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { fetchWithTimeout, NETWORK_MESSAGE, TIMEOUT_MESSAGE } from '../../src/lib/fetchTimeout.ts';

const realFetch = globalThis.fetch;
let lastSignal: AbortSignal | undefined;

/** Stub `fetch` to resolve after `delayMs` (or never), rejecting like the real one on abort. */
function stubFetch(delayMs: number | null, failWith?: Error): void {
  globalThis.fetch = (_url, init) => {
    lastSignal = init?.signal ?? undefined;
    return new Promise((resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      signal?.addEventListener('abort', () => reject(signal.reason));
      if (failWith) {
        reject(failWith);
      } else if (delayMs !== null) {
        setTimeout(() => resolve(new Response('ok')), delayMs);
      }
    });
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  lastSignal = undefined;
});

describe('fetchWithTimeout', () => {
  test('returns the response and stops timing once headers arrive', async () => {
    stubFetch(5);
    const response = await fetchWithTimeout('/x', { timeoutMs: 30 });
    assert.equal(await response.text(), 'ok');
    // Past the timeout: a body read would still be allowed.
    await sleep(50);
    assert.equal(lastSignal?.aborted, false);
  });

  test('rejects with a readable message when the headers are late', async () => {
    stubFetch(null);
    await assert.rejects(fetchWithTimeout('/x', { timeoutMs: 10 }), { message: TIMEOUT_MESSAGE });
  });

  test('null timeout never aborts', async () => {
    stubFetch(40);
    const response = await fetchWithTimeout('/x', { timeoutMs: null });
    assert.equal(response.ok, true);
  });

  test('turns a network TypeError into a message about reaching the server', async () => {
    stubFetch(null, new TypeError('Failed to fetch'));
    await assert.rejects(fetchWithTimeout('/x'), { message: NETWORK_MESSAGE });
  });

  test("passes the caller's abort through unchanged", async () => {
    stubFetch(null);
    const controller = new AbortController();
    const request = fetchWithTimeout('/x', { signal: controller.signal, timeoutMs: 1000 });
    controller.abort(new Error('left page'));
    await assert.rejects(request, { message: 'left page' });
  });

  test('an already-aborted caller signal aborts immediately', async () => {
    stubFetch(null);
    const signal = AbortSignal.abort(new Error('gone'));
    await assert.rejects(fetchWithTimeout('/x', { signal, timeoutMs: 1000 }), { message: 'gone' });
  });
});
