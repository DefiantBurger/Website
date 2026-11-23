import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { NETWORK_MESSAGE, TIMEOUT_MESSAGE } from '../../src/lib/fetchTimeout.ts';
import { postWithProgress, STALL_MESSAGE } from '../../src/lib/postWithProgress.ts';

type Handler = ((event: Partial<ProgressEvent>) => void) | null;

/** Just enough of XMLHttpRequest for `postWithProgress`; tests fire its events by hand. */
class FakeXhr {
  static last: FakeXhr;
  upload: { onprogress: Handler; onload: Handler } = { onprogress: null, onload: null };
  onload: Handler = null;
  onerror: Handler = null;
  responseType = '';
  status = 0;
  response: Blob | null = null;
  aborted = false;
  #contentType = '';

  constructor() {
    FakeXhr.last = this;
  }
  open(): void {}
  send(): void {}
  abort(): void {
    this.aborted = true;
  }
  getResponseHeader(name: string): string | null {
    return name === 'content-type' ? this.#contentType : null;
  }

  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true });
  }
  respond(status: number, body: string, contentType: string): void {
    this.upload.onload?.({});
    this.status = status;
    this.response = new Blob([body]);
    this.#contentType = contentType;
    this.onload?.({});
  }
}

// node --test runs each file in its own process, so the fake can't leak into other tests.
globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;

describe('postWithProgress', () => {
  test('reports progress and resolves with the response', async () => {
    const seen: [number, number][] = [];
    const request = postWithProgress('/x', {
      body: 'data',
      onProgress: (loaded, total) => seen.push([loaded, total]),
    });
    FakeXhr.last.progress(2, 4);
    FakeXhr.last.progress(4, 4);
    FakeXhr.last.respond(413, '{"error":"too big"}', 'application/json');

    const response = await request;
    assert.deepEqual(seen, [
      [2, 4],
      [4, 4],
    ]);
    assert.equal(response.status, 413);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.deepEqual(await response.json(), { error: 'too big' });
  });

  test('fails with a stall message when no progress arrives in time', async () => {
    const request = postWithProgress('/x', { body: 'data', stallMs: 10 });
    await assert.rejects(request, { message: STALL_MESSAGE });
    assert.equal(FakeXhr.last.aborted, true);
  });

  test('each progress event restarts the stall timer', async () => {
    const request = postWithProgress('/x', { body: 'data', stallMs: 30 });
    const xhr = FakeXhr.last;
    for (let sent = 1; sent <= 5; sent++) {
      await sleep(10);
      xhr.progress(sent, 10);
    }
    xhr.respond(200, '{}', 'application/json');
    assert.equal((await request).status, 200);
    assert.equal(xhr.aborted, false);
  });

  test('once the body is sent, waits only for the response timeout', async () => {
    const request = postWithProgress('/x', { body: 'data', stallMs: 1000, responseTimeoutMs: 10 });
    FakeXhr.last.upload.onload?.({});
    await assert.rejects(request, { message: TIMEOUT_MESSAGE });
  });

  test('turns a network error into a message about reaching the server', async () => {
    const request = postWithProgress('/x', { body: 'data' });
    FakeXhr.last.onerror?.({});
    await assert.rejects(request, { message: NETWORK_MESSAGE });
  });
});
