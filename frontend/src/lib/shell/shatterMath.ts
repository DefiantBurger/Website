// Geometry and physics for the `sudo` shatter effect. Pure, so node:test can run it;
// shatter.ts does the DOM side.

export type Point = { x: number; y: number };

export type Shard = {
  polygon: Point[];
  center: Point;
  /** Farthest vertex from the center, so a rotated shard's extent is known. */
  radius: number;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  spin: number;
  /** Seconds before it starts moving. */
  delay: number;
};

/** The part of `polygon` closer to `a` than to `b` (one Sutherland–Hodgman pass). */
function clipCloser(polygon: Point[], a: Point, b: Point): Point[] {
  const nx = b.x - a.x;
  const ny = b.y - a.y;
  const offset = (nx * (a.x + b.x) + ny * (a.y + b.y)) / 2;
  const side = (p: Point) => nx * p.x + ny * p.y - offset;
  const out: Point[] = [];
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) {
      out.push(p);
    }
    if (sp * sq < 0) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  });
  return out;
}

/** Jittered-grid seeds (no slivers) and their Voronoi cells over a width×height rect. */
export function voronoi(
  width: number,
  height: number,
  count: number,
  random: () => number,
): { seeds: Point[]; cells: Point[][] } {
  const cols = Math.max(1, Math.round(Math.sqrt((count * width) / height)));
  const rows = Math.max(1, Math.round(count / cols));
  const seeds: Point[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      seeds.push({
        x: ((col + 0.15 + random() * 0.7) * width) / cols,
        y: ((row + 0.15 + random() * 0.7) * height) / rows,
      });
    }
  }
  const rect = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const cells = seeds.map((seed) =>
    seeds.reduce((cell, other) => (other === seed ? cell : clipCloser(cell, seed, other)), rect),
  );
  return { seeds, cells };
}

/** Signed area; positive for clockwise polygons in screen coordinates. */
export function area(polygon: Point[]): number {
  let sum = 0;
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    sum += p.x * q.y - q.x * p.y;
  });
  return sum / 2;
}

function centroid(polygon: Point[]): Point {
  let x = 0;
  let y = 0;
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    const cross = p.x * q.y - q.x * p.y;
    x += (p.x + q.x) * cross;
    y += (p.y + q.y) * cross;
  });
  const a6 = area(polygon) * 6;
  return { x: x / a6, y: y / a6 };
}

/** Shards kicked away from `impact`; the break spreads outward from it. */
export function makeShards(cells: Point[][], impact: Point, random: () => number): Shard[] {
  const centers = cells.map(centroid);
  const distances = centers.map((c) => Math.hypot(c.x - impact.x, c.y - impact.y));
  const farthest = Math.max(...distances, 1);
  return cells.map((polygon, i) => {
    const center = centers[i];
    const distance = Math.max(distances[i], 1);
    const kick = 60 + random() * 140;
    return {
      polygon,
      center,
      radius: Math.max(...polygon.map((p) => Math.hypot(p.x - center.x, p.y - center.y))),
      x: 0,
      y: 0,
      angle: 0,
      vx: ((center.x - impact.x) / distance) * kick,
      // A small upward pop before gravity takes over.
      vy: ((center.y - impact.y) / distance) * kick * 0.5 - random() * 150,
      spin: (random() - 0.5) * 4,
      delay: (distances[i] / farthest) * 0.35 + random() * 0.1,
    };
  });
}

/** Advances a shard by `dt` seconds under gravity `g` (px/s²). */
export function step(shard: Shard, dt: number, g: number): void {
  if (shard.delay > 0) {
    shard.delay -= dt;
    return;
  }
  shard.vy += g * dt;
  shard.x += shard.vx * dt;
  shard.y += shard.vy * dt;
  shard.angle += shard.spin * dt;
}

/** True once no part of the shard can still be on screen. */
export function isGone(shard: Shard, height: number): boolean {
  return shard.center.y + shard.y - shard.radius > height;
}
