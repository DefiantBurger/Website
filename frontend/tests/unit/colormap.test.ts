import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { cyclicTable, parseColor, rampTable } from '../../src/lib/demos/colormap.ts';

describe('parseColor', () => {
  test('reads hex and rgb() forms', () => {
    assert.deepEqual(parseColor(' #2ebdff'), [46, 189, 255]);
    assert.deepEqual(parseColor('#fff'), [255, 255, 255]);
    assert.deepEqual(parseColor('rgb(1, 2, 3)'), [1, 2, 3]);
    assert.deepEqual(parseColor('rgba(10 20 30 / 0.5)'), [10, 20, 30]);
  });

  test('rejects anything else', () => {
    assert.throws(() => parseColor('teal'));
  });
});

describe('tables', () => {
  test('a ramp runs from the first color to the second', () => {
    const table = rampTable([0, 0, 0], [255, 100, 50]);
    assert.deepEqual([...table.slice(0, 3)], [0, 0, 0]);
    assert.deepEqual([...table.slice(255 * 3)], [255, 100, 50]);
  });

  test('a cyclic table starts on the first stop and wraps back toward it', () => {
    const table = cyclicTable([
      [255, 0, 0],
      [0, 255, 0],
    ]);
    assert.deepEqual([...table.slice(0, 3)], [255, 0, 0]);
    assert.deepEqual([...table.slice(128 * 3, 129 * 3)], [0, 255, 0]);
    assert.ok(table[255 * 3] > 250);
  });
});
