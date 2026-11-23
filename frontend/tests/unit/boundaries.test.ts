import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  AbsorbingBox,
  ExactBox,
  PACKET_START,
  type BoxPacket,
} from '../../src/lib/demos/boundaries.ts';

const n = 64;
const head: BoxPacket = { k0: 1, sigma: 4, angle: 0 };

function meanX(box: { re: Float64Array; im: Float64Array }): number {
  let total = 0;
  let weighted = 0;
  for (let i = 0; i < box.re.length; i++) {
    const p = box.re[i] ** 2 + box.im[i] ** 2;
    total += p;
    weighted += p * (i % n);
  }
  return weighted / total;
}

/** Total |ψ|² in column x. */
function column(box: ExactBox, x: number): number {
  let total = 0;
  for (let y = 0; y < n; y++) {
    total += box.re[y * n + x] ** 2 + box.im[y * n + x] ** 2;
  }
  return total;
}

describe('ExactBox', () => {
  test('returns the starting packet at t = 0 and conserves the norm later', () => {
    for (const boundary of ['periodic', 'dirichlet', 'neumann'] as const) {
      const box = new ExactBox(n, boundary, { ...head, angle: 0.4 });
      const re = box.re.slice();
      const im = box.im.slice();
      box.advanceTo(0);
      for (let i = 0; i < n * n; i++) {
        assert.ok(Math.abs(box.re[i] - re[i]) < 1e-12 && Math.abs(box.im[i] - im[i]) < 1e-12);
      }
      assert.ok(Math.abs(box.norm() - 1) < 1e-12, boundary);
      box.advanceTo(137.5);
      assert.ok(Math.abs(box.norm() - 1) < 1e-10, `${boundary}: ${box.norm()}`);
    }
  });

  test('a free packet moves at its group velocity k0', () => {
    const box = new ExactBox(n, 'periodic', { ...head, k0: 0.8 });
    const start = meanX(box);
    assert.ok(Math.abs(start - PACKET_START.x * n) < 0.01);
    box.advanceTo(15);
    assert.ok(Math.abs(meanX(box) - start - 0.8 * 15) < 0.05);
  });

  test('Dirichlet has a node at the wall and Neumann a peak', () => {
    // Slow enough that the node, half a cell past the last column, darkens that column.
    const packet = { ...head, k0: 0.5 };
    const hit = (n - PACKET_START.x * n) / packet.k0;
    const dirichlet = new ExactBox(n, 'dirichlet', packet);
    const neumann = new ExactBox(n, 'neumann', packet);
    dirichlet.advanceTo(hit);
    neumann.advanceTo(hit);
    assert.ok(column(dirichlet, n - 1) < 0.1 * column(neumann, n - 1));
  });

  test('a Dirichlet wall flips the phase of the reflected packet and Neumann keeps it', () => {
    // Once the packet is back from the right wall, only its mirror image is in the box,
    // with sign -1 for Dirichlet and +1 for Neumann. A bigger box keeps the spreading
    // packet's tails off the other walls, whose images would differ too.
    const big = 2 * n;
    const packet = { ...head, sigma: 8 };
    const dirichlet = new ExactBox(big, 'dirichlet', packet);
    const neumann = new ExactBox(big, 'neumann', packet);
    const back = (1.2 * big) / packet.k0;
    dirichlet.advanceTo(back);
    neumann.advanceTo(back);
    let sum = 0;
    for (let i = 0; i < big * big; i++) {
      sum += (dirichlet.re[i] + neumann.re[i]) ** 2 + (dirichlet.im[i] + neumann.im[i]) ** 2;
    }
    assert.ok(sum < 1e-3, `|ψ_D + ψ_N|² = ${sum}`);
  });
});

describe('AbsorbingBox', () => {
  test('drains the packet instead of reflecting or wrapping it', () => {
    const box = new AbsorbingBox(n, { ...head, angle: 0.4 });
    assert.ok(Math.abs(box.norm() - 1) < 1e-12);
    box.advanceTo((1.4 * n) / head.k0);
    assert.ok(box.norm() < 0.01, `left in box: ${box.norm()}`);
  });

  test('only steps forward', () => {
    const box = new AbsorbingBox(n, head);
    box.advanceTo(10);
    const { time } = box;
    const re = box.re.slice();
    box.advanceTo(5);
    assert.equal(box.time, time);
    assert.deepEqual(box.re, re);
  });
});
