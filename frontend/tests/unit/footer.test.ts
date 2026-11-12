import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { commitInfo, formatUptime } from '../../src/lib/footer.ts';

describe('formatUptime', () => {
  test('truncates to two decimals instead of rounding up', () => {
    assert.equal(formatUptime(99.9969), '99.99');
    assert.equal(formatUptime(99.947), '99.94');
    assert.equal(formatUptime(100), '100.00');
  });

  test('survives float error at exact values', () => {
    assert.equal(formatUptime(99.99), '99.99');
    assert.equal(formatUptime(98.5), '98.50');
  });
});

describe('commitInfo', () => {
  test('shortens a SHA and links the commit', () => {
    const sha = '3b697c4d2f1e0a9b8c7d6e5f4a3b2c1d0e9f8a7b';
    assert.deepEqual(commitInfo(sha, 'https://github.com/x/y'), {
      short: '3b697c4',
      url: `https://github.com/x/y/commit/${sha}`,
    });
  });

  test('has no link without a usable SHA', () => {
    assert.deepEqual(commitInfo('', 'https://github.com/x/y'), {
      short: 'unknown',
      url: undefined,
    });
  });
});
