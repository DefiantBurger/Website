/**
 * In-place radix-2 FFT for square n×n complex grids stored as separate re/im arrays.
 * Hand-written to avoid a dependency; n must be a power of two.
 */
export class Fft2D {
  readonly n: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) {
      throw new Error(`Fft2D: size must be a power of two, got ${n}`);
    }
    this.n = n;
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) {
        r |= ((i >> b) & 1) << (bits - 1 - b);
      }
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
  }

  /** 1D FFT of the contiguous row starting at `offset`. Unnormalized in both directions. */
  row(re: Float64Array, im: Float64Array, offset: number, inverse: boolean): void {
    const { n, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        const a = offset + i;
        const b = offset + j;
        let t = re[a];
        re[a] = re[b];
        re[b] = t;
        t = im[a];
        im[a] = im[b];
        im[b] = t;
      }
    }
    const sign = inverse ? -1 : 1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const stride = n / size;
      for (let start = 0; start < n; start += size) {
        for (let j = 0; j < half; j++) {
          const wr = cos[j * stride];
          const wi = sign * sin[j * stride];
          const a = offset + start + j;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }

  /**
   * 2D FFT of a row-major grid. Columns are transformed as rows after a transpose,
   * which is much more cache-friendly than strided access, so the output is left
   * transposed: a forward transform of grid[y][x] yields spectrum[kx][ky], and an
   * inverse transform of spectrum[kx][ky] yields grid[y][x] again. Unnormalized.
   */
  transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const { n } = this;
    for (let r = 0; r < n; r++) {
      this.row(re, im, r * n, inverse);
    }
    transpose(re, n);
    transpose(im, n);
    for (let r = 0; r < n; r++) {
      this.row(re, im, r * n, inverse);
    }
  }
}

function transpose(a: Float64Array, n: number): void {
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = i * n + j;
      const q = j * n + i;
      const t = a[p];
      a[p] = a[q];
      a[q] = t;
    }
  }
}
