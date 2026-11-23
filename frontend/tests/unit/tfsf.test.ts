import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  TfsfSim,
  clampVertex,
  polygonDistance,
  regularPolygon,
  type IncidentWave,
} from '../../src/lib/demos/tfsf.ts';

const n = 64;
const wave: IncidentWave = { k0: 1, angle: 0.4 };

/** Largest |ψ - ζψ_inc(t)| over the cells where ζ < `below`. */
function deviation(sim: TfsfSim, below: number): number {
  const omega = (wave.k0 * wave.k0) / 2;
  const kx = wave.k0 * Math.cos(wave.angle);
  const ky = wave.k0 * Math.sin(wave.angle);
  let worst = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (sim.mask[i] >= below) {
        continue;
      }
      const phase = kx * x + ky * y - omega * sim.time;
      const re = sim.mask[i] * Math.cos(phase);
      const im = sim.mask[i] * Math.sin(phase);
      worst = Math.max(worst, Math.hypot(sim.re[i] - re, sim.im[i] - im));
    }
  }
  return worst;
}

describe('TfsfSim', () => {
  test('with no scatterer, carries ζψ_inc forward exactly and nothing leaves the box', () => {
    const sim = new TfsfSim(n, wave, { vertices: regularPolygon(3, n), barrier: 0 });
    sim.step(200);
    assert.ok(deviation(sim, Infinity) < 1e-12);
  });

  test('with no scatterer, the total field is the incident plane wave everywhere', () => {
    const sim = new TfsfSim(n, wave, { vertices: regularPolygon(3, n), barrier: 0 });
    sim.step(50);
    const re = new Float64Array(n * n);
    const im = new Float64Array(n * n);
    sim.totalField(re, im);
    for (let i = 0; i < n * n; i++) {
      assert.ok(Math.abs(Math.hypot(re[i], im[i]) - 1) < 1e-12);
    }
  });

  test('a scatterer sends a wave out of the box', () => {
    const sim = new TfsfSim(n, wave, { vertices: regularPolygon(4, n), barrier: 3 });
    assert.equal(deviation(sim, 1e-3), 0);
    sim.step(150);
    assert.ok(deviation(sim, 1e-3) > 0.05);
  });

  test('reshaping the scatterer keeps the running field and clock', () => {
    const sim = new TfsfSim(n, wave, { vertices: regularPolygon(3, n), barrier: 3 });
    sim.step(20);
    const re = sim.re.slice();
    const time = sim.time;
    sim.setScatterer({ vertices: regularPolygon(5, n), barrier: -1 });
    assert.equal(sim.time, time);
    assert.deepEqual(sim.re, re);
    assert.ok(sim.shape.some((s) => s < -0.99));
  });
});

describe('polygonDistance', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  test('is negative inside and positive outside, with the distance to the nearest edge', () => {
    assert.equal(polygonDistance(square, 5, 5), -5);
    assert.equal(polygonDistance(square, 2, 5), -2);
    assert.equal(polygonDistance(square, 13, 5), 3);
    assert.equal(polygonDistance(square, 13, 14), 5);
  });

  test('fills a self-intersecting polygon even-odd', () => {
    // A bowtie: the two triangles are inside, the gaps above and below the crossing are not.
    const bowtie = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    assert.ok(polygonDistance(bowtie, 2, 5) < 0);
    assert.ok(polygonDistance(bowtie, 5, 2) > 0);
  });
});

describe('scatterer placement', () => {
  test("default polygons start where vertices may sit, at the demo's grid size", () => {
    // The vertex inset is in cells, so on much smaller grids the default polygon doesn't fit.
    const demoN = 128;
    for (let sides = 3; sides <= 7; sides++) {
      for (const p of regularPolygon(sides, demoN)) {
        assert.deepEqual(clampVertex(p, demoN), p);
      }
    }
  });

  test('clampVertex keeps a dragged vertex inside the box', () => {
    const a = clampVertex({ x: -100, y: 1000 }, n);
    const b = clampVertex({ x: 1000, y: -100 }, n);
    assert.ok(a.x < n / 2 && a.y > n / 2);
    assert.ok(b.x > n / 2 && b.y < n / 2);
    assert.ok(a.x > 0 && b.x < n);
  });
});
