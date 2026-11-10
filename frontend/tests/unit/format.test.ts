import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatBytes, formatDuration, formatMinutes, formatTime } from '../../src/lib/format.ts';

describe('formatBytes', () => {
  test('uses decimal units with precision by magnitude', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(999), '999 B');
    assert.equal(formatBytes(1500), '1.50 KB');
    assert.equal(formatBytes(80_000_000), '80.0 MB');
    assert.equal(formatBytes(2e15), '2000.0 TB');
  });

  test('treats invalid input as zero', () => {
    assert.equal(formatBytes(-1), '0 B');
    assert.equal(formatBytes(Number.NaN), '0 B');
  });

  test('trim drops only all-zero decimals', () => {
    assert.equal(formatBytes(80_000_000, { trim: true }), '80 MB');
    assert.equal(formatBytes(1_000_000, { trim: true }), '1 MB');
    assert.equal(formatBytes(1_500_000, { trim: true }), '1.50 MB');
  });
});

describe('durations', () => {
  test('formatDuration pads seconds', () => {
    assert.equal(formatDuration(600), '10m 00s');
    assert.equal(formatDuration(65), '1m 05s');
    assert.equal(formatDuration(0), '0m 00s');
  });

  test('formatMinutes rounds and pluralizes', () => {
    assert.equal(formatMinutes(600), '10 minutes');
    assert.equal(formatMinutes(60), '1 minute');
    assert.equal(formatMinutes(80), '1 minute');
  });
});

describe('formatTime', () => {
  test('accepts a Date or an ISO string and includes seconds', () => {
    const date = new Date(2026, 0, 2, 15, 4, 5);
    assert.equal(formatTime(date), formatTime(date.toISOString()));
    assert.match(formatTime(date), /04.05/);
  });

  test('returns unparseable input unchanged', () => {
    assert.equal(formatTime('not a date'), 'not a date');
  });
});
