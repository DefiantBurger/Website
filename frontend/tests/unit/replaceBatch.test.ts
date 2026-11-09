import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { replaceBatch, type ReplaceBatchOps } from '../../src/lib/fileshare/replaceBatch.ts';

interface FakeFile {
  name: string;
}

/** In-memory stand-in for the backend: appends at max + 1, like `save_upload`. */
function fakeServer(existing: number[], options: { failOn?: string; failDelete?: boolean } = {}) {
  const stored = new Map<number, string>(existing.map((i) => [i, `old-${i}`]));
  const ops: ReplaceBatchOps<FakeFile, { occurrenceIndex: number }> = {
    listIndices: async () => [...stored.keys()],
    upload: async (file) => {
      if (file.name === options.failOn) {
        throw new Error('too big');
      }
      const occurrenceIndex = Math.max(0, ...stored.keys()) + 1;
      stored.set(occurrenceIndex, file.name);
      return { occurrenceIndex };
    },
    deleteIndices: async (indices) => {
      if (options.failDelete) {
        throw new Error('network');
      }
      indices.forEach((i) => stored.delete(i));
    },
  };
  return { ops, names: () => [...stored.values()] };
}

const files = (...names: string[]) => names.map((name) => ({ name }));

describe('replaceBatch', () => {
  test('replaces the old files once every upload succeeds', async () => {
    const server = fakeServer([1, 2]);
    const result = await replaceBatch(files('a', 'b'), server.ops);

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.uploaded, [
      { occurrenceIndex: 3 },
      { occurrenceIndex: 4 },
    ]);
    assert.equal(result.ok && result.oldFilesRemoved, true);
    assert.deepEqual(server.names(), ['a', 'b']);
  });

  test('keeps the old files and removes partial uploads when one fails', async () => {
    const server = fakeServer([1], { failOn: 'b' });
    const result = await replaceBatch(files('a', 'b', 'c'), server.ops);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failedFile, 'b');
      assert.equal(result.uploadedCount, 1);
      assert.equal(result.rolledBack, true);
      assert.equal((result.error as Error).message, 'too big');
    }
    assert.deepEqual(server.names(), ['old-1']);
  });

  test('reports a failed rollback', async () => {
    const server = fakeServer([1], { failOn: 'b', failDelete: true });
    const result = await replaceBatch(files('a', 'b'), server.ops);

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.rolledBack, false);
    assert.deepEqual(server.names(), ['old-1', 'a']);
  });

  test('reports old files it could not remove', async () => {
    const server = fakeServer([1], { failDelete: true });
    const result = await replaceBatch(files('a'), server.ops);

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.oldFilesRemoved, false);
  });

  test('a first-time key needs no delete', async () => {
    const server = fakeServer([], { failDelete: true });
    const result = await replaceBatch(files('a'), server.ops);

    assert.equal(result.ok && result.oldFilesRemoved, true);
  });

  test('a failed listing aborts before any upload', async () => {
    const server = fakeServer([1]);
    await assert.rejects(
      replaceBatch(files('a'), {
        ...server.ops,
        listIndices: () => Promise.reject(new Error('down')),
      }),
    );
    assert.deepEqual(server.names(), ['old-1']);
  });
});
