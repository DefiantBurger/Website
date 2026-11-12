import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  area,
  isGone,
  makeShards,
  step,
  voronoi,
  type Point,
} from '../../src/lib/shell/shatterMath.ts';

/** Deterministic PRNG (mulberry32) so failures reproduce. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isConvex(polygon: Point[]): boolean {
  const signs = polygon.map((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    const r = polygon[(i + 2) % polygon.length];
    return Math.sign((q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x));
  });
  return signs.every((s) => s >= 0) || signs.every((s) => s <= 0);
}

/** Ray casting; fine for the convex cells here. */
function contains(polygon: Point[], point: Point): boolean {
  let inside = false;
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    if (p.y > point.y !== q.y > point.y) {
      const x = p.x + ((point.y - p.y) / (q.y - p.y)) * (q.x - p.x);
      if (point.x < x) {
        inside = !inside;
      }
    }
  });
  return inside;
}

describe('voronoi', () => {
  for (const [width, height, count] of [
    [1280, 720, 24],
    [400, 800, 14],
  ]) {
    test(`tiles a ${width}x${height} viewport with about ${count} convex cells`, () => {
      const { seeds, cells } = voronoi(width, height, count, seeded(width));
      assert.equal(cells.length, seeds.length);
      assert.ok(Math.abs(cells.length - count) <= 4);
      cells.forEach((cell, i) => {
        assert.ok(cell.length >= 3);
        assert.ok(isConvex(cell));
        assert.ok(contains(cell, seeds[i]));
      });
      const total = cells.reduce((sum, cell) => sum + Math.abs(area(cell)), 0);
      assert.ok(Math.abs(total - width * height) < width * height * 0.001);
    });
  }
});

describe('makeShards', () => {
  const { cells } = voronoi(1000, 1000, 25, seeded(1));
  const impact = { x: 500, y: 500 };
  const shards = makeShards(cells, impact, () => 0.5);

  test('the break spreads outward from the impact point', () => {
    const byDistance = [...shards].sort(
      (a, b) =>
        Math.hypot(a.center.x - impact.x, a.center.y - impact.y) -
        Math.hypot(b.center.x - impact.x, b.center.y - impact.y),
    );
    for (let i = 1; i < byDistance.length; i++) {
      assert.ok(byDistance[i].delay >= byDistance[i - 1].delay);
    }
  });

  test('shards are kicked away from the impact point', () => {
    for (const shard of shards) {
      if (Math.abs(shard.center.x - impact.x) > 1) {
        assert.equal(Math.sign(shard.vx), Math.sign(shard.center.x - impact.x));
      }
    }
  });
});

describe('step', () => {
  test('waits out the delay, then falls under gravity until off screen', () => {
    const [shard] = makeShards(voronoi(100, 100, 1, () => 0.5).cells, { x: 0, y: 0 }, () => 0.5);
    const delay = shard.delay;
    step(shard, delay, 1000);
    assert.equal(shard.y, 0);
    const vy = shard.vy;
    step(shard, 0.1, 1000);
    assert.equal(shard.vy, vy + 100);
    assert.ok(!isGone(shard, 100));
    for (let i = 0; i < 100; i++) {
      step(shard, 1 / 30, 1000);
    }
    assert.ok(isGone(shard, 100));
  });
});
