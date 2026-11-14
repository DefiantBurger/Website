import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DOUBLE_SLIT,
  PACKET_X,
  SCATTERERS,
  SCATTERER_X,
  WavepacketSim,
  scattererDistance,
  type PacketParams,
} from '../../src/lib/demos/wavepacket.ts';

const n = 64;
const free: PacketParams = { k0: 1, sigma: 5, scatterer: 'disk', barrier: 0 };

function meanX(sim: WavepacketSim): number {
  let total = 0;
  let weighted = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const p = sim.re[i] ** 2 + sim.im[i] ** 2;
      total += p;
      weighted += p * x;
    }
  }
  return weighted / total;
}

describe('WavepacketSim', () => {
  test('starts normalized and centered on the launch point', () => {
    const sim = new WavepacketSim(n, free);
    assert.ok(Math.abs(sim.norm() - 1) < 1e-12);
    // Not exact: the far tail of the Gaussian wraps around the periodic box.
    assert.ok(Math.abs(meanX(sim) - PACKET_X * n) < 0.01);
  });

  test('conserves the norm and energy through a scatterer when nothing absorbs', () => {
    for (const scatterer of SCATTERERS) {
      const sim = new WavepacketSim(n, { ...free, scatterer, barrier: 2 }, { absorb: false });
      const before = sim.energy();
      sim.step(80);
      const after = sim.energy();
      assert.ok(Math.abs(sim.norm() - 1) < 1e-10, scatterer);
      const e0 = before.kinetic + before.potential;
      const e1 = after.kinetic + after.potential;
      assert.ok(Math.abs(e1 - e0) / e0 < 1e-3, `${scatterer}: ${e0} -> ${e1}`);
    }
  });

  test('a free packet moves at its group velocity k0', () => {
    const sim = new WavepacketSim(n, { ...free, k0: 0.8 }, { absorb: false });
    const start = meanX(sim);
    sim.step(40);
    assert.ok(Math.abs(meanX(sim) - start - 0.8 * sim.time) < 0.05);
  });

  test('free flight leaves |φ(k)| unchanged', () => {
    const sim = new WavepacketSim(n, free, { absorb: false });
    const before = new Float64Array(n * n);
    const after = new Float64Array(n * n);
    sim.momentumDensity(before);
    sim.step(30);
    sim.momentumDensity(after);
    const peak = Math.max(...before);
    for (let i = 0; i < n * n; i++) {
      assert.ok(Math.abs(after[i] - before[i]) < 1e-9 * peak);
    }
  });

  test('momentum density is centered with the packet peak at (k0, 0)', () => {
    const sim = new WavepacketSim(n, { ...free, k0: (2 * Math.PI * 8) / n });
    const out = new Float64Array(n * n);
    sim.momentumDensity(out);
    const peak = out.indexOf(Math.max(...out));
    assert.equal(peak % n, n / 2 + 8);
    assert.equal(Math.floor(peak / n), n / 2);
  });

  test('the absorbing edges soak up a packet that leaves the box', () => {
    const sim = new WavepacketSim(n, free);
    sim.step(Math.round((2 * n) / sim.dt));
    assert.ok(sim.norm() < 1e-3);
  });

  test('a barrier taller than the packet energy reflects much of it', () => {
    const leftBehind = (barrier: number) => {
      const sim = new WavepacketSim(
        n,
        { ...free, scatterer: 'square', barrier, sigma: 4 },
        {
          absorb: false,
        },
      );
      sim.step(Math.round((0.5 * n) / sim.dt));
      let total = 0;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < 0.4 * n; x++) {
          total += sim.re[y * n + x] ** 2 + sim.im[y * n + x] ** 2;
        }
      }
      return total;
    };
    assert.ok(leftBehind(0) < 0.05);
    assert.ok(leftBehind(4) > 0.5);
  });

  test('the double-slit wall has a fixed height and ignores the barrier setting', () => {
    const run = (barrier: number) => {
      const sim = new WavepacketSim(
        n,
        { ...free, scatterer: 'double-slit', barrier },
        { absorb: false },
      );
      sim.step(80);
      return sim;
    };
    const well = run(-2);
    const tall = run(4);
    assert.deepEqual(well.re, tall.re);
    assert.ok(well.shape.every((value) => value >= 0));
  });

  test('stepping zero times leaves the state untouched', () => {
    const sim = new WavepacketSim(n, { ...free, barrier: 2 });
    const before = sim.re.slice();
    sim.step(0);
    assert.deepEqual(sim.re, before);
    assert.equal(sim.time, 0);
  });
});

describe('scattererDistance', () => {
  test('is negative at the center of every solid scatterer and positive far away', () => {
    for (const scatterer of ['disk', 'square', 'triangle'] as const) {
      assert.ok(scattererDistance(scatterer, SCATTERER_X * 128, 64, 128) < 0, scatterer);
      assert.ok(scattererDistance(scatterer, 10, 10, 128) > 0, scatterer);
    }
  });

  test('the double slit is open at the slits and solid between them', () => {
    const x = SCATTERER_X * 128;
    const slit = DOUBLE_SLIT.slitOffset;
    assert.ok(scattererDistance('double-slit', x, 64, 128) < 0);
    assert.ok(scattererDistance('double-slit', x, 64 + slit, 128) > 0);
    assert.ok(scattererDistance('double-slit', x, 64 - slit, 128) > 0);
    assert.ok(scattererDistance('double-slit', x, 2, 128) < 0);
  });
});
