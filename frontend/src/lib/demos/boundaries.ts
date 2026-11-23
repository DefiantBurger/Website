/**
 * A free wave packet in a square box under four boundary conditions, for the
 * boundary-conditions demo in the quantum scattering write-up. Units: ħ = m = 1,
 * grid spacing 1. Each box exposes the n×n field it shows as `re`/`im`.
 */
import { Fft2D, multiplyComplex, waveNumber } from './fft';

export const BOUNDARIES = ['periodic', 'dirichlet', 'neumann', 'absorbing'] as const;
export type Boundary = (typeof BOUNDARIES)[number];
export type WallBoundary = Exclude<Boundary, 'absorbing'>;

export interface BoxPacket {
  /** Momentum in radians per cell; the packet moves at this speed. */
  k0: number;
  /** Width of the packet: the standard deviation of |ψ|², in cells. */
  sigma: number;
  /** Direction of travel in radians, from +x toward +y (down on screen). */
  angle: number;
}

/** Launch point as fractions of the box. */
export const PACKET_START = { x: 0.4, y: 0.4 };
// Long steps are fine: the absorber is the only potential, so splitting error just
// shifts how the layer absorbs (under 0.2% returns for k0 ≥ 0.5), and it keeps the
// absorbing box cheap enough to advance alongside whichever box is on screen.
const DT = 0.75;
const ABSORB_WIDTH = 0.12;
const ABSORB_STRENGTH = 0.5;

/**
 * Periodic, Dirichlet, or Neumann box. With no potential the split-operator step is
 * just the kinetic phase, which is exact for any dt, so instead of stepping, the box
 * jumps straight to time t with one inverse FFT of the starting spectrum.
 *
 * Dirichlet and Neumann are what a sine or cosine transform (DST-II, DCT-II) solver
 * gives, done with the FFT: those transforms equal an FFT of the box mirrored across
 * each wall, with the mirror image's sign flipped (Dirichlet) or not (Neumann). So the
 * box runs as a periodic grid twice the size in each direction, and the view is the
 * original quadrant. The walls sit half a cell outside the outermost cells.
 */
export class ExactBox {
  readonly n: number;
  readonly boundary: WallBoundary;
  readonly re: Float64Array;
  readonly im: Float64Array;
  time = 0;

  private readonly size: number;
  private readonly fft: Fft2D;
  private readonly k2: Float64Array;
  private readonly specRe: Float64Array;
  private readonly specIm: Float64Array;
  private readonly workRe: Float64Array;
  private readonly workIm: Float64Array;

  constructor(n: number, boundary: WallBoundary, packet: BoxPacket) {
    this.n = n;
    this.boundary = boundary;
    this.size = boundary === 'periodic' ? n : 2 * n;
    const { size } = this;
    this.fft = new Fft2D(size);
    this.re = new Float64Array(n * n);
    this.im = new Float64Array(n * n);
    this.specRe = new Float64Array(size * size);
    this.specIm = new Float64Array(size * size);
    this.workRe = new Float64Array(size * size);
    this.workIm = new Float64Array(size * size);
    // |k|² is symmetric in kx and ky, so the FFT's transposed spectrum doesn't matter.
    this.k2 = new Float64Array(size * size);
    for (let a = 0; a < size; a++) {
      for (let b = 0; b < size; b++) {
        this.k2[a * size + b] = waveNumber(a, size) ** 2 + waveNumber(b, size) ** 2;
      }
    }
    this.reset(packet);
  }

  reset(packet: BoxPacket): void {
    const { n, size, specRe, specIm } = this;
    fillPacket(this.re, this.im, n, packet);
    const sign = this.boundary === 'dirichlet' ? -1 : 1;
    for (let y = 0; y < size; y++) {
      const sy = y < n ? 1 : sign;
      const row = (y < n ? y : size - 1 - y) * n;
      for (let x = 0; x < size; x++) {
        const s = x < n ? sy : sy * sign;
        const j = row + (x < n ? x : size - 1 - x);
        specRe[y * size + x] = s * this.re[j];
        specIm[y * size + x] = s * this.im[j];
      }
    }
    this.fft.transform(specRe, specIm, false);
    this.time = 0;
  }

  advanceTo(time: number): void {
    const { n, size, k2, specRe, specIm, workRe, workIm } = this;
    const norm = 1 / (size * size);
    for (let i = 0; i < size * size; i++) {
      const phase = (-k2[i] * time) / 2;
      const c = Math.cos(phase) * norm;
      const s = Math.sin(phase) * norm;
      workRe[i] = specRe[i] * c - specIm[i] * s;
      workIm[i] = specRe[i] * s + specIm[i] * c;
    }
    this.fft.transform(workRe, workIm, true);
    for (let y = 0; y < n; y++) {
      this.re.set(workRe.subarray(y * size, y * size + n), y * n);
      this.im.set(workIm.subarray(y * size, y * size + n), y * n);
    }
    this.time = time;
  }

  norm(): number {
    return norm(this.re, this.im);
  }
}

/**
 * Periodic box with a complex absorbing potential -iη·s² ramping up toward the edges,
 * as in the wave-packet demo. The absorber is a potential, so this one has to step.
 */
export class AbsorbingBox {
  readonly n: number;
  readonly re: Float64Array;
  readonly im: Float64Array;
  /** Absorber strength from 0 (none) to 1 (at the edge), for drawing the layer. */
  readonly layer: Float64Array;
  time = 0;

  private readonly fft: Fft2D;
  private readonly halfRe: Float64Array;
  private readonly halfIm: Float64Array;
  private readonly fullRe: Float64Array;
  private readonly fullIm: Float64Array;
  private readonly kinRe: Float64Array;
  private readonly kinIm: Float64Array;

  constructor(n: number, packet: BoxPacket) {
    this.n = n;
    const size = n * n;
    this.fft = new Fft2D(n);
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.layer = new Float64Array(size);
    // The damping is real, so the half and full steps have no imaginary part.
    this.halfRe = new Float64Array(size);
    this.halfIm = new Float64Array(size);
    this.fullRe = new Float64Array(size);
    this.fullIm = new Float64Array(size);
    this.kinRe = new Float64Array(size);
    this.kinIm = new Float64Array(size);

    const margin = ABSORB_WIDTH * n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const edge = Math.min(x, y, n - 1 - x, n - 1 - y);
        const s = Math.max(0, (margin - edge) / margin);
        this.layer[i] = s * s;
        this.halfRe[i] = Math.exp((-ABSORB_STRENGTH * s * s * DT) / 2);
        this.fullRe[i] = this.halfRe[i] ** 2;
      }
    }
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const i = a * n + b;
        const phase = (-(waveNumber(a, n) ** 2 + waveNumber(b, n) ** 2) * DT) / 2;
        this.kinRe[i] = Math.cos(phase) / size;
        this.kinIm[i] = Math.sin(phase) / size;
      }
    }
    this.reset(packet);
  }

  reset(packet: BoxPacket): void {
    fillPacket(this.re, this.im, this.n, packet);
    this.time = 0;
  }

  /** Step forward to the step nearest `time`. It can't go back; reset to start over. */
  advanceTo(time: number): void {
    const count = Math.round((time - this.time) / DT);
    if (count <= 0) {
      return;
    }
    // Strang splitting with adjacent half steps merged, as in WavepacketSim.step.
    const { re, im, fft } = this;
    multiplyComplex(re, im, this.halfRe, this.halfIm);
    for (let s = 0; s < count; s++) {
      fft.transform(re, im, false);
      multiplyComplex(re, im, this.kinRe, this.kinIm);
      fft.transform(re, im, true);
      if (s < count - 1) {
        multiplyComplex(re, im, this.fullRe, this.fullIm);
      } else {
        multiplyComplex(re, im, this.halfRe, this.halfIm);
      }
    }
    this.time += count * DT;
  }

  norm(): number {
    return norm(this.re, this.im);
  }
}

/** Normalized Gaussian packet at PACKET_START, written into an n×n grid. */
function fillPacket(re: Float64Array, im: Float64Array, n: number, packet: BoxPacket): void {
  const x0 = PACKET_START.x * n;
  const y0 = PACKET_START.y * n;
  const kx = packet.k0 * Math.cos(packet.angle);
  const ky = packet.k0 * Math.sin(packet.angle);
  const width = 4 * packet.sigma * packet.sigma;
  let total = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const envelope = Math.exp(-((x - x0) ** 2 + (y - y0) ** 2) / width);
      const phase = kx * x + ky * y;
      re[i] = envelope * Math.cos(phase);
      im[i] = envelope * Math.sin(phase);
      total += envelope * envelope;
    }
  }
  const scale = 1 / Math.sqrt(total);
  for (let i = 0; i < n * n; i++) {
    re[i] *= scale;
    im[i] *= scale;
  }
}

function norm(re: Float64Array, im: Float64Array): number {
  let total = 0;
  for (let i = 0; i < re.length; i++) {
    total += re[i] * re[i] + im[i] * im[i];
  }
  return total;
}
