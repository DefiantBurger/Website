import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { Fft2D } from '../../src/lib/demos/fft.ts';

function randomGrid(size: number, seed: number): Float64Array {
  const out = new Float64Array(size);
  let state = seed;
  for (let i = 0; i < size; i++) {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    out[i] = state / 2 ** 31 - 0.5;
  }
  return out;
}

describe('Fft2D', () => {
  test('matches a naive 2D DFT, with the output transposed', () => {
    const n = 8;
    const re = randomGrid(n * n, 1);
    const im = randomGrid(n * n, 2);
    const inRe = re.slice();
    const inIm = im.slice();
    new Fft2D(n).transform(re, im, false);

    for (let kx = 0; kx < n; kx++) {
      for (let ky = 0; ky < n; ky++) {
        let sumRe = 0;
        let sumIm = 0;
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            const angle = (-2 * Math.PI * (kx * x + ky * y)) / n;
            const a = inRe[y * n + x];
            const b = inIm[y * n + x];
            sumRe += a * Math.cos(angle) - b * Math.sin(angle);
            sumIm += a * Math.sin(angle) + b * Math.cos(angle);
          }
        }
        assert.ok(Math.abs(re[kx * n + ky] - sumRe) < 1e-9);
        assert.ok(Math.abs(im[kx * n + ky] - sumIm) < 1e-9);
      }
    }
  });

  test('inverse undoes forward up to a factor of n²', () => {
    const n = 16;
    const re = randomGrid(n * n, 3);
    const im = randomGrid(n * n, 4);
    const inRe = re.slice();
    const fft = new Fft2D(n);
    fft.transform(re, im, false);
    fft.transform(re, im, true);
    for (let i = 0; i < n * n; i++) {
      assert.ok(Math.abs(re[i] / (n * n) - inRe[i]) < 1e-12);
    }
  });

  test('rejects sizes that are not powers of two', () => {
    assert.throws(() => new Fft2D(12));
  });
});
