import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { messageLength, secondsLeft, withLocalExpiry } from '../../src/lib/messageboard/board.ts';

// The backend's timestamp format (Python isoformat with microseconds).
const SERVER_NOW = '2026-01-01T12:00:00.000000+00:00';
const message = {
  id: 'a',
  text: 'hi',
  createdAt: '2026-01-01T11:59:30.000000+00:00',
  expiresAt: '2026-01-01T12:00:30.000000+00:00',
};

describe('withLocalExpiry', () => {
  test('keeps the time left on the server, whatever the local clock says', () => {
    for (const skew of [0, 5 * 60_000, -5 * 60_000]) {
      const receivedAt = Date.parse(SERVER_NOW) + skew;
      const [live] = withLocalExpiry([message], SERVER_NOW, receivedAt);
      assert.equal(secondsLeft(live, receivedAt), 30);
    }
  });
});

describe('secondsLeft', () => {
  const live = { ...message, expiresAtMs: 10_000 };

  test('rounds up to whole seconds', () => {
    assert.equal(secondsLeft(live, 0), 10);
    assert.equal(secondsLeft(live, 9_001), 1);
  });

  test('is zero once expired', () => {
    assert.equal(secondsLeft(live, 10_000), 0);
    assert.equal(secondsLeft(live, 20_000), 0);
  });
});

describe('messageLength', () => {
  test('counts code points, so emoji count once', () => {
    assert.equal(messageLength('😀😀'), 2);
  });

  test('counts NFC-normalized and trimmed, like the server', () => {
    assert.equal(messageLength('  café \n'), 4);
  });
});
