// Canvas colormaps built from the site's CSS color variables, so demos follow the theme.

export type Rgb = [number, number, number];

/**
 * Parse `#rgb`, `#rrggbb`, or `rgb()/rgba()` (alpha is ignored). getComputedStyle returns
 * a custom property as written in app.css, unresolved, so the variables a demo reads
 * must be written in one of these forms.
 */
export function parseColor(value: string): Rgb {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((d) => d + d)
            .join('')
        : hex[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  throw new Error(`parseColor: unsupported color "${value}" (demo colors must be hex or rgb())`);
}

/** 256-entry RGB lookup table running linearly from `from` to `to`. */
export function rampTable(from: Rgb, to: Rgb): Uint8ClampedArray {
  const table = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    for (let c = 0; c < 3; c++) {
      table[i * 3 + c] = from[c] + (to[c] - from[c]) * t;
    }
  }
  return table;
}

/**
 * 256-entry RGB table around the phase circle, blending evenly between `stops`
 * and wrapping back to the first, so -π and π get the same color.
 */
export function cyclicTable(stops: Rgb[]): Uint8ClampedArray {
  const table = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const position = (i / 256) * stops.length;
    const index = Math.floor(position);
    const t = position - index;
    const a = stops[index];
    const b = stops[(index + 1) % stops.length];
    for (let c = 0; c < 3; c++) {
      table[i * 3 + c] = a[c] + (b[c] - a[c]) * t;
    }
  }
  return table;
}
