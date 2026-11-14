/**
 * 2D time-dependent Schrödinger solver using the split-operator method, for the
 * wave-packet demo in the quantum scattering write-up. Units: ħ = m = 1, grid
 * spacing 1. Positions and sizes are fractions of the grid so any size works.
 */
import { Fft2D } from './fft';

export const SCATTERERS = ['disk', 'square', 'triangle', 'double-slit'] as const;
export type Scatterer = (typeof SCATTERERS)[number];

export interface PacketParams {
  /** Packet momentum along +x (radians per cell); energy is k0²/2. */
  k0: number;
  /** Width of the packet: the standard deviation of |ψ|², in cells. */
  sigma: number;
  scatterer: Scatterer;
  /** Scatterer height as a multiple of the packet energy; negative makes a well. Ignored by the double slit. */
  barrier: number;
}

export interface SimOptions {
  /** Absorb the wave near the edges instead of letting it wrap around (periodic box). */
  absorb?: boolean;
}

export const PACKET_X = 0.27;
export const SCATTERER_X = 0.56;
/**
 * Double-slit geometry in cells, not grid fractions: whether the fringes come out
 * clean depends on the slits' size relative to the wavelength (2π/k0 cells) and the
 * packet width, which don't scale with the grid. Slits 18 apart keep the far field
 * (d²/λ) inside the box at k0 = 1. The wall's height is fixed (wallBarrier, in units
 * of the packet energy): a wall this thin leaks by tunnelling at lower heights.
 */
export const DOUBLE_SLIT = {
  halfThickness: 1.5,
  slitHalfWidth: 2.5,
  slitOffset: 9,
  wallBarrier: 6,
};
const DT = 0.25;
const ABSORB_WIDTH = 0.12;
const ABSORB_STRENGTH = 0.5;
// Scatterer edges are blurred over about a cell; a hard step makes the spectral method ring.
const EDGE_SOFTNESS = 0.75;

export class WavepacketSim {
  readonly n: number;
  readonly dt: number;
  readonly re: Float64Array;
  readonly im: Float64Array;
  /** Potential in units of its peak height (0 outside, ±1 inside), for drawing the scatterer. */
  readonly shape: Float64Array;
  time = 0;

  private readonly fft: Fft2D;
  private readonly absorb: boolean;
  private readonly potential: Float64Array;
  private readonly k2: Float64Array;
  // Precomputed step operators: potential (with edge absorption) for half and full
  // steps, and the kinetic phase with the inverse FFT's 1/n² folded in.
  private readonly halfRe: Float64Array;
  private readonly halfIm: Float64Array;
  private readonly fullRe: Float64Array;
  private readonly fullIm: Float64Array;
  private readonly kinRe: Float64Array;
  private readonly kinIm: Float64Array;
  private readonly scratchRe: Float64Array;
  private readonly scratchIm: Float64Array;

  constructor(n: number, params: PacketParams, options: SimOptions = {}) {
    this.n = n;
    this.dt = DT;
    this.absorb = options.absorb ?? true;
    this.fft = new Fft2D(n);
    const size = n * n;
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.shape = new Float64Array(size);
    this.potential = new Float64Array(size);
    this.halfRe = new Float64Array(size);
    this.halfIm = new Float64Array(size);
    this.fullRe = new Float64Array(size);
    this.fullIm = new Float64Array(size);
    this.kinRe = new Float64Array(size);
    this.kinIm = new Float64Array(size);
    this.scratchRe = new Float64Array(size);
    this.scratchIm = new Float64Array(size);

    // The spectrum is stored transposed (see Fft2D), but |k|² is symmetric in kx and ky.
    this.k2 = new Float64Array(size);
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const ka = waveNumber(a, n);
        const kb = waveNumber(b, n);
        this.k2[a * n + b] = ka * ka + kb * kb;
      }
    }
    const norm = 1 / size;
    for (let i = 0; i < size; i++) {
      const phase = (-this.k2[i] * this.dt) / 2;
      this.kinRe[i] = Math.cos(phase) * norm;
      this.kinIm[i] = Math.sin(phase) * norm;
    }

    this.reset(params);
  }

  /** Start over with a fresh packet, rebuilding the potential for the new parameters. */
  reset(params: PacketParams): void {
    this.time = 0;
    const { n, dt } = this;
    const strength = params.scatterer === 'double-slit' ? DOUBLE_SLIT.wallBarrier : params.barrier;
    const height = (strength * params.k0 * params.k0) / 2;
    const margin = ABSORB_WIDTH * n;

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const inside =
          0.5 * (1 - Math.tanh(scattererDistance(params.scatterer, x, y, n) / EDGE_SOFTNESS));
        this.shape[i] = Math.sign(strength) * inside;
        this.potential[i] = height * inside;

        // Complex absorbing potential -iη·s², ramping up quadratically toward the edges.
        let decay = 0;
        if (this.absorb) {
          const edge = Math.min(x, y, n - 1 - x, n - 1 - y);
          const s = Math.max(0, (margin - edge) / margin);
          decay = ABSORB_STRENGTH * s * s;
        }
        const phaseHalf = (-this.potential[i] * dt) / 2;
        const ampHalf = Math.exp((-decay * dt) / 2);
        this.halfRe[i] = ampHalf * Math.cos(phaseHalf);
        this.halfIm[i] = ampHalf * Math.sin(phaseHalf);
        this.fullRe[i] = ampHalf * ampHalf * Math.cos(2 * phaseHalf);
        this.fullIm[i] = ampHalf * ampHalf * Math.sin(2 * phaseHalf);
      }
    }

    // Gaussian packet; |ψ|² has standard deviation sigma in each direction.
    const x0 = PACKET_X * n;
    const y0 = n / 2;
    const width = 4 * params.sigma * params.sigma;
    let total = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const envelope = Math.exp(-((x - x0) ** 2 + (y - y0) ** 2) / width);
        this.re[i] = envelope * Math.cos(params.k0 * x);
        this.im[i] = envelope * Math.sin(params.k0 * x);
        total += envelope * envelope;
      }
    }
    const scale = 1 / Math.sqrt(total);
    for (let i = 0; i < n * n; i++) {
      this.re[i] *= scale;
      this.im[i] *= scale;
    }
  }

  /**
   * Advance `count` steps with Strang splitting (half potential, kinetic, half
   * potential). Adjacent half steps are merged into one full step, so this costs
   * the same as first-order splitting.
   */
  step(count: number): void {
    if (count <= 0) {
      return;
    }
    const { re, im, fft } = this;
    multiply(re, im, this.halfRe, this.halfIm);
    for (let s = 0; s < count; s++) {
      fft.transform(re, im, false);
      multiply(re, im, this.kinRe, this.kinIm);
      fft.transform(re, im, true);
      if (s < count - 1) {
        multiply(re, im, this.fullRe, this.fullIm);
      } else {
        multiply(re, im, this.halfRe, this.halfIm);
      }
    }
    this.time += count * this.dt;
  }

  /** Total probability left in the box (starts at 1; the absorbing edges remove some). */
  norm(): number {
    let total = 0;
    for (let i = 0; i < this.re.length; i++) {
      total += this.re[i] * this.re[i] + this.im[i] * this.im[i];
    }
    return total;
  }

  /** Forward-transform a copy of ψ into the scratch arrays (transposed, see Fft2D). */
  private spectrum(): void {
    this.scratchRe.set(this.re);
    this.scratchIm.set(this.im);
    this.fft.transform(this.scratchRe, this.scratchIm, false);
  }

  /**
   * Write |φ(k)|² into `out` in display order: row-major [ky][kx] with k = 0 at
   * the center (index n/2), so kx increases to the right and ky downward.
   */
  momentumDensity(out: Float64Array): void {
    const { n, scratchRe, scratchIm } = this;
    this.spectrum();
    const half = n / 2;
    for (let row = 0; row < n; row++) {
      const ky = (row + half) % n;
      for (let col = 0; col < n; col++) {
        const kx = (col + half) % n;
        const j = kx * n + ky;
        out[row * n + col] = scratchRe[j] * scratchRe[j] + scratchIm[j] * scratchIm[j];
      }
    }
  }

  /** Expected kinetic and potential energy per unit probability. */
  energy(): { kinetic: number; potential: number } {
    const { n, scratchRe, scratchIm } = this;
    this.spectrum();
    let kinetic = 0;
    let spectral = 0;
    for (let i = 0; i < n * n; i++) {
      const p = scratchRe[i] * scratchRe[i] + scratchIm[i] * scratchIm[i];
      kinetic += (p * this.k2[i]) / 2;
      spectral += p;
    }
    let potential = 0;
    let total = 0;
    for (let i = 0; i < n * n; i++) {
      const p = this.re[i] * this.re[i] + this.im[i] * this.im[i];
      potential += p * this.potential[i];
      total += p;
    }
    return { kinetic: kinetic / spectral, potential: potential / total };
  }
}

/** Angular wave number of FFT bin `i` on an n-point grid with unit spacing. */
export function waveNumber(i: number, n: number): number {
  return (2 * Math.PI * (i < n / 2 ? i : i - n)) / n;
}

function multiply(re: Float64Array, im: Float64Array, mRe: Float64Array, mIm: Float64Array): void {
  for (let i = 0; i < re.length; i++) {
    const a = re[i];
    const b = im[i];
    re[i] = a * mRe[i] - b * mIm[i];
    im[i] = a * mIm[i] + b * mRe[i];
  }
}

/** Signed distance (negative inside) from cell (x, y) to the scatterer's edge. */
export function scattererDistance(scatterer: Scatterer, x: number, y: number, n: number): number {
  const dx = x - SCATTERER_X * n;
  const dy = y - n / 2;
  switch (scatterer) {
    case 'disk':
      return Math.hypot(dx, dy) - 0.08 * n;
    case 'square':
      return boxDistance(dx, dy, 0.07 * n, 0.07 * n);
    case 'triangle': {
      // Equilateral, one vertex pointing back at the incoming packet.
      const r = 0.1 * n;
      let distance = -Infinity;
      for (const angle of [Math.PI, Math.PI / 3, -Math.PI / 3]) {
        // Each edge's outward normal points away from its opposite vertex.
        const nx = -Math.cos(angle);
        const ny = -Math.sin(angle);
        distance = Math.max(distance, dx * nx + dy * ny - r / 2);
      }
      return distance;
    }
    case 'double-slit': {
      const { halfThickness, slitHalfWidth, slitOffset } = DOUBLE_SLIT;
      // Wall = everything along the column except the two slits: middle bar plus two outer bars.
      const middle = boxDistance(dx, dy, halfThickness, slitOffset - slitHalfWidth);
      const outerStart = slitOffset + slitHalfWidth;
      const outerHalf = (n - outerStart) / 2;
      const outerCenter = outerStart + outerHalf;
      const top = boxDistance(dx, dy + outerCenter, halfThickness, outerHalf);
      const bottom = boxDistance(dx, dy - outerCenter, halfThickness, outerHalf);
      return Math.min(middle, top, bottom);
    }
  }
}

function boxDistance(dx: number, dy: number, halfWidth: number, halfHeight: number): number {
  const qx = Math.abs(dx) - halfWidth;
  const qy = Math.abs(dy) - halfHeight;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}
