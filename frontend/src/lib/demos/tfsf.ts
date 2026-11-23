/**
 * Total-field/scattered-field (TF/SF) scattering of a plane wave off a polygon, for the
 * tfsf demo in the quantum scattering write-up. Units: ħ = m = 1, grid spacing 1. The
 * stepper is wavepacket.ts's split-operator method plus a source that keeps the
 * incident wave inside a box (where the mask ζ = 1), so ψ holds the total field
 * inside the box and only the scattered wave outside it.
 */
import { Fft2D, multiplyComplex, waveNumber } from './fft';

export interface Point {
  x: number;
  y: number;
}

export interface IncidentWave {
  /** Wave number in radians per cell; the energy is k0²/2. */
  k0: number;
  /** Direction of travel in radians, from +x toward +y (down on screen). */
  angle: number;
}

export interface Scatterer {
  /** Polygon corners in grid cells. Any order; self-intersecting shapes fill even-odd. */
  vertices: Point[];
  /** Potential height as a multiple of the wave's energy; negative makes a well. */
  barrier: number;
}

/** Width of the absorbing layer as a fraction of the grid. The demo crops it out of view. */
export const ABSORB_WIDTH = 0.125;
/** The total-field box, as fractions of the grid on both axes. */
export const BOX = { min: 0.3125, max: 0.6875 };
// ζ ramps from 0 to 1 over a few of these (cells) around the box edge.
const MASK_SOFTNESS = 1;
// Vertices stay this many cells inside the box, so the potential sits where ζ = 1.
const VERTEX_INSET = 6;
const DT = 0.25;
const ABSORB_STRENGTH = 0.5;
// Scatterer edges are blurred over about a cell; a hard step makes the spectral method ring.
const EDGE_SOFTNESS = 0.75;
// Past this many cells outside the polygon, the blurred potential is below 1e-6.
const EDGE_REACH = 8 * EDGE_SOFTNESS;

/** Cells of absorbing layer along each edge. */
export function absorbMargin(n: number): number {
  return Math.round(ABSORB_WIDTH * n);
}

export class TfsfSim {
  readonly n: number;
  readonly dt = DT;
  /** ψ as simulated: total field in the box, scattered field outside. */
  readonly re: Float64Array;
  readonly im: Float64Array;
  /** Potential in units of its peak height (0 outside, ±1 inside), for drawing the scatterer. */
  readonly shape: Float64Array;
  /** The mask ζ: 1 inside the total-field box, 0 outside. */
  readonly mask: Float64Array;
  time = 0;

  private readonly fft: Fft2D;
  private wave: IncidentWave;
  private scatterer: Scatterer;
  private omega = 0;
  // Half-step damping of the absorbing layer (real), and the full half-step operator
  // with the scatterer's potential folded in.
  private readonly damping: Float64Array;
  private readonly halfRe: Float64Array;
  private readonly halfIm: Float64Array;
  // Kinetic phase with the inverse FFT's 1/n² folded in.
  private readonly kinRe: Float64Array;
  private readonly kinIm: Float64Array;
  // The incident wave's spatial part e^{ik·r}, and the source term (see reset).
  private readonly incRe: Float64Array;
  private readonly incIm: Float64Array;
  private readonly srcRe: Float64Array;
  private readonly srcIm: Float64Array;

  constructor(n: number, wave: IncidentWave, scatterer: Scatterer) {
    this.n = n;
    this.fft = new Fft2D(n);
    this.wave = wave;
    this.scatterer = scatterer;
    const size = n * n;
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.shape = new Float64Array(size);
    this.mask = new Float64Array(size);
    this.damping = new Float64Array(size);
    this.halfRe = new Float64Array(size);
    this.halfIm = new Float64Array(size);
    this.kinRe = new Float64Array(size);
    this.kinIm = new Float64Array(size);
    this.incRe = new Float64Array(size);
    this.incIm = new Float64Array(size);
    this.srcRe = new Float64Array(size);
    this.srcIm = new Float64Array(size);

    const margin = absorbMargin(n);
    const lo = BOX.min * n;
    const hi = BOX.max * n;
    const ramp = (t: number) =>
      0.25 * (1 + Math.tanh((t - lo) / MASK_SOFTNESS)) * (1 + Math.tanh((hi - t) / MASK_SOFTNESS));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        this.mask[i] = ramp(x) * ramp(y);
        // Complex absorbing potential -iη·s², ramping up quadratically toward the edges.
        const s = Math.max(0, (margin - Math.min(x, y, n - 1 - x, n - 1 - y)) / margin);
        this.damping[i] = Math.exp((-ABSORB_STRENGTH * s * s * DT) / 2);
      }
    }
    // The spectrum is stored transposed (see Fft2D), but |k|² is symmetric in kx and ky.
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const phase = (-(waveNumber(a, n) ** 2 + waveNumber(b, n) ** 2) * DT) / 2;
        this.kinRe[a * n + b] = Math.cos(phase) / size;
        this.kinIm[a * n + b] = Math.sin(phase) / size;
      }
    }
    this.reset(wave);
  }

  /**
   * Start over with a new incident wave: ψ = ζψ_inc, the incident wave already filling
   * the box, so the run starts in TF/SF balance instead of with a switch-on transient.
   *
   * The write-up's source is (∇²ζ + 2ik·∇ζ)ψ_inc / 2, added to ψ as -iS·dt each step,
   * which is right only to first order in dt, so some incident wave leaks out of the
   * box. Here the source is instead whatever makes ζψ_inc an exact solution of the
   * stepped equation: R = e^{-iω·dt}ζφ - U(ζφ), with φ = e^{ik·r} and U one step
   * without the scatterer. Adding e^{-iωt}R after each step then carries ζψ_inc
   * forward exactly, so outside the box ψ is the scattered wave alone, to rounding.
   * R is the same as dt·(-iS) in the limit of small steps.
   */
  reset(wave: IncidentWave): void {
    this.wave = wave;
    this.time = 0;
    const { n, mask, damping } = this;
    const kx = wave.k0 * Math.cos(wave.angle);
    const ky = wave.k0 * Math.sin(wave.angle);
    this.omega = (wave.k0 * wave.k0) / 2;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const phase = kx * x + ky * y;
        this.incRe[i] = Math.cos(phase);
        this.incIm[i] = Math.sin(phase);
        this.re[i] = mask[i] * this.incRe[i];
        this.im[i] = mask[i] * this.incIm[i];
      }
    }

    // U(ζφ) with the absorbing layer but no scatterer, computed in the source arrays.
    const { srcRe, srcIm } = this;
    srcRe.set(this.re);
    srcIm.set(this.im);
    for (let i = 0; i < n * n; i++) {
      srcRe[i] *= damping[i];
      srcIm[i] *= damping[i];
    }
    this.fft.transform(srcRe, srcIm, false);
    multiplyComplex(srcRe, srcIm, this.kinRe, this.kinIm);
    this.fft.transform(srcRe, srcIm, true);
    const c = Math.cos(-this.omega * DT);
    const s = Math.sin(-this.omega * DT);
    for (let i = 0; i < n * n; i++) {
      const u = this.re[i];
      const v = this.im[i];
      srcRe[i] = c * u - s * v - srcRe[i] * damping[i];
      srcIm[i] = c * v + s * u - srcIm[i] * damping[i];
    }

    // The potential's height scales with the wave's energy.
    this.setScatterer(this.scatterer);
  }

  /** Change the scatterer without restarting: the wave already in the box scatters off the new shape. */
  setScatterer(scatterer: Scatterer): void {
    this.scatterer = scatterer;
    const { n, shape, damping } = this;
    const height = (scatterer.barrier * this.wave.k0 * this.wave.k0) / 2;
    const sign = Math.sign(scatterer.barrier);
    const { vertices } = scatterer;
    const xs = vertices.map((p) => p.x);
    const ys = vertices.map((p) => p.y);
    // Only cells near the polygon need its distance; the potential is ~0 beyond that.
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - EDGE_REACH));
    const x1 = Math.min(n - 1, Math.ceil(Math.max(...xs) + EDGE_REACH));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - EDGE_REACH));
    const y1 = Math.min(n - 1, Math.ceil(Math.max(...ys) + EDGE_REACH));
    shape.fill(0);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const inside = 0.5 * (1 - Math.tanh(polygonDistance(vertices, x, y) / EDGE_SOFTNESS));
        shape[y * n + x] = sign * inside;
      }
    }
    for (let i = 0; i < n * n; i++) {
      const phase = (-height * Math.abs(shape[i]) * DT) / 2;
      this.halfRe[i] = damping[i] * Math.cos(phase);
      this.halfIm[i] = damping[i] * Math.sin(phase);
    }
  }

  /** Advance `count` steps: Strang splitting (half potential, kinetic, half potential), then the source. */
  step(count: number): void {
    const { re, im, fft, srcRe, srcIm } = this;
    for (let step = 0; step < count; step++) {
      multiplyComplex(re, im, this.halfRe, this.halfIm);
      fft.transform(re, im, false);
      multiplyComplex(re, im, this.kinRe, this.kinIm);
      fft.transform(re, im, true);
      multiplyComplex(re, im, this.halfRe, this.halfIm);
      const c = Math.cos(-this.omega * this.time);
      const s = Math.sin(-this.omega * this.time);
      for (let i = 0; i < re.length; i++) {
        re[i] += c * srcRe[i] - s * srcIm[i];
        im[i] += c * srcIm[i] + s * srcRe[i];
      }
      this.time += DT;
    }
  }

  /**
   * Write the total field into `outRe`/`outIm`: ψ plus the incident wave the
   * simulation leaves out of the scattered-field region, (1 - ζ)ψ_inc.
   */
  totalField(outRe: Float64Array, outIm: Float64Array): void {
    const { re, im, mask, incRe, incIm } = this;
    const c = Math.cos(-this.omega * this.time);
    const s = Math.sin(-this.omega * this.time);
    for (let i = 0; i < re.length; i++) {
      const outside = 1 - mask[i];
      outRe[i] = re[i] + outside * (c * incRe[i] - s * incIm[i]);
      outIm[i] = im[i] + outside * (c * incIm[i] + s * incRe[i]);
    }
  }
}

/** Signed distance (negative inside) from (x, y) to the polygon's outline. */
export function polygonDistance(vertices: Point[], x: number, y: number): number {
  let nearest = Infinity;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[j];
    const b = vertices[i];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const length2 = ex * ex + ey * ey;
    const t =
      length2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * ex + (y - a.y) * ey) / length2)) : 0;
    nearest = Math.min(nearest, Math.hypot(x - a.x - t * ex, y - a.y - t * ey));
    // Even-odd rule: count edges crossed by a ray from (x, y) toward +x.
    if (a.y > y !== b.y > y && x < a.x + ((y - a.y) / (b.y - a.y)) * ex) {
      inside = !inside;
    }
  }
  return inside ? -nearest : nearest;
}

/**
 * Regular polygon centered in the box, with one vertex pointing back along -x, at
 * the incoming wave's default direction.
 */
export function regularPolygon(sides: number, n: number): Point[] {
  const center = n / 2;
  const radius = 0.1 * n;
  return Array.from({ length: sides }, (_, i) => {
    const angle = Math.PI + (2 * Math.PI * i) / sides;
    return { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) };
  });
}

/** The nearest point to `p` where a vertex may sit (inside the box, clear of ζ's ramp). */
export function clampVertex(p: Point, n: number): Point {
  const lo = BOX.min * n + VERTEX_INSET;
  const hi = BOX.max * n - VERTEX_INSET;
  return { x: Math.min(hi, Math.max(lo, p.x)), y: Math.min(hi, Math.max(lo, p.y)) };
}
