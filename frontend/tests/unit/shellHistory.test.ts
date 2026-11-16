import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ShellHistory } from '../../src/lib/shell/history.ts';

function withEntries(...commands: string[]): ShellHistory {
  const history = new ShellHistory();
  commands.forEach((command) => history.add(command));
  return history;
}

describe('ShellHistory', () => {
  test('add skips blank commands', () => {
    assert.deepEqual(withEntries('ls', '', 'pwd').entries, ['ls', 'pwd']);
  });

  test('recall walks back, stops at the oldest, and returns null at either end', () => {
    const history = withEntries('ls', 'pwd');
    assert.equal(history.recall(1, ''), null);
    assert.equal(history.recall(-1, ''), 'pwd');
    assert.equal(history.recall(-1, 'pwd'), 'ls');
    assert.equal(history.recall(-1, 'ls'), null);
  });

  test('stepping past the newest entry restores the draft', () => {
    const history = withEntries('ls');
    assert.equal(history.recall(-1, 'cd pro'), 'ls');
    assert.equal(history.recall(1, 'ls'), 'cd pro');
    assert.equal(history.recall(1, 'cd pro'), null);
  });

  test('add ends a recall in progress, even for a blank command', () => {
    const history = withEntries('ls', 'pwd');
    history.recall(-1, '');
    history.recall(-1, 'pwd');
    history.add('');
    assert.equal(history.recall(-1, ''), 'pwd');
  });

  test('empty history recalls nothing', () => {
    assert.equal(new ShellHistory().recall(-1, 'x'), null);
  });
});
