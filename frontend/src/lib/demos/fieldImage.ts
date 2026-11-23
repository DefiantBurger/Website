// Paints a complex wave function into canvas pixels, in the site's theme colors.
import { cyclicTable, parseColor, rampTable, type Rgb } from './colormap';

export type FieldView = 'density' | 'phase';

export interface FieldPalette {
  background: Rgb;
  /** Background to accent, for |ψ|. */
  ramp: Uint8ClampedArray;
  /** Hue loop for arg ψ. */
  phase: Uint8ClampedArray;
}

/** Build the palette from an element's computed style. Rebuild it when the theme changes. */
export function readFieldPalette(style: CSSStyleDeclaration): FieldPalette {
  const color = (name: string) => parseColor(style.getPropertyValue(name));
  const background = color('--color-bg-surface');
  return {
    background,
    ramp: rampTable(background, color('--color-accent')),
    // A loop through the theme's hues stands in for a hue wheel.
    phase: cyclicTable([
      color('--color-accent'),
      color('--color-concurrent'),
      color('--color-error'),
      color('--color-warning'),
      color('--color-success'),
    ]),
  };
}

/** Largest |ψ|² in the field. */
export function peakDensity(re: Float64Array, im: Float64Array): number {
  let peak = 0;
  for (let i = 0; i < re.length; i++) {
    peak = Math.max(peak, re[i] * re[i] + im[i] * im[i]);
  }
  return peak;
}

/**
 * Write ψ into RGBA `pixels`, with |ψ|² = `peak` at full strength: |ψ| on the ramp
 * (density view), or arg ψ on the hue loop faded toward the background where |ψ| is
 * small (phase view). |ψ| rather than |ψ|², so faint scattered waves stay visible.
 */
export function paintField(
  pixels: Uint8ClampedArray,
  re: Float64Array,
  im: Float64Array,
  peak: number,
  view: FieldView,
  { background, ramp, phase }: FieldPalette,
): void {
  const scale = peak > 0 ? 1 / Math.sqrt(peak) : 0;
  for (let i = 0; i < re.length; i++) {
    const level = Math.min(1, Math.hypot(re[i], im[i]) * scale);
    const p = i * 4;
    if (view === 'density') {
      const j = Math.round(level * 255) * 3;
      pixels[p] = ramp[j];
      pixels[p + 1] = ramp[j + 1];
      pixels[p + 2] = ramp[j + 2];
    } else {
      const j =
        (Math.floor(((Math.atan2(im[i], re[i]) + Math.PI) / (2 * Math.PI)) * 256) & 255) * 3;
      pixels[p] = background[0] + (phase[j] - background[0]) * level;
      pixels[p + 1] = background[1] + (phase[j + 1] - background[1]) * level;
      pixels[p + 2] = background[2] + (phase[j + 2] - background[2]) * level;
    }
    pixels[p + 3] = 255;
  }
}

/** Blend `color` over pixel `i` with opacity `alpha` (0 to 1). */
export function tintPixel(pixels: Uint8ClampedArray, i: number, color: Rgb, alpha: number): void {
  const p = i * 4;
  for (let c = 0; c < 3; c++) {
    pixels[p + c] += (color[c] - pixels[p + c]) * alpha;
  }
}
