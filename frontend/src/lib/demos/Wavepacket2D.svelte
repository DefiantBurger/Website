<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { theme } from '../theme.svelte';
  import { parseColor, type Rgb } from './colormap';
  import './demo.css';
  import {
    paintField,
    peakDensity,
    readFieldPalette,
    tintPixel,
    type FieldPalette,
    type FieldView,
  } from './fieldImage';
  import { runFrames, watchVisibility } from './playback';
  import {
    DOUBLE_SLIT,
    SCATTERERS,
    WavepacketSim,
    type PacketParams,
    type Scatterer,
  } from './wavepacket';

  const N = 128;
  // 30 fps target; at k0 = 1 the packet crosses the box in about 5 s.
  const FRAME_MS = 1000 / 30;
  const STEPS_PER_FRAME = 3;
  // Views scale to the current peak, but never above these fractions of the starting
  // peak, so the last scraps in the absorbing edges fade out instead of glowing.
  const REAL_FLOOR = 0.05;
  const MOMENTUM_FLOOR = 0.01;
  // Momentum view spans this many decades below its peak, so the faint scattered ring shows.
  const K_DECADES = 4;

  const SCATTERER_LABELS: Record<Scatterer, string> = {
    'disk': 'Disk',
    'square': 'Square',
    'triangle': 'Triangle',
    'double-slit': 'Double slit',
  };

  const DEFAULTS: PacketParams = { k0: 1, sigma: 7, scatterer: 'disk', barrier: 2 };

  let k0 = $state(DEFAULTS.k0);
  let sigma = $state(DEFAULTS.sigma);
  let barrier = $state(DEFAULTS.barrier);
  let scatterer = $state(DEFAULTS.scatterer);
  let view = $state<FieldView>('density');
  let playing = $state(false);
  let visible = $state(false);
  let time = $state(0);
  let remaining = $state(1);

  let root: HTMLElement;
  let realCanvas: HTMLCanvasElement;
  let momentumCanvas: HTMLCanvasElement;

  const sim = new WavepacketSim(N, DEFAULTS);
  const momentum = new Float64Array(N * N);
  let startPeak = 0;
  let startMomentumPeak = 0;
  let realImage: ImageData | undefined;
  let momentumImage: ImageData | undefined;
  let realContext: CanvasRenderingContext2D | null = null;
  let momentumContext: CanvasRenderingContext2D | null = null;
  interface Palette extends FieldPalette {
    wall: Rgb;
    well: Rgb;
  }
  let colors: Palette | undefined;

  const finished = $derived(remaining < 0.02 || time > (3 * N) / k0);
  // Radius of |k| = k0 in momentum-view pixels (the view spans -π to π).
  const ringRadius = $derived((k0 * N) / (2 * Math.PI));
  const wallFixed = $derived(scatterer === 'double-slit');
  const params = $derived<PacketParams>({ k0, sigma, scatterer, barrier });

  function readColors() {
    const style = getComputedStyle(root);
    const color = (name: string) => parseColor(style.getPropertyValue(name));
    colors = {
      ...readFieldPalette(style),
      wall: color('--color-text-muted'),
      well: color('--color-warning'),
    };
  }

  function draw() {
    if (!colors || !realImage || !momentumImage) {
      return;
    }
    drawReal(realImage.data, colors);
    drawMomentum(momentumImage.data, colors.ramp);
    realContext?.putImageData(realImage, 0, 0);
    momentumContext?.putImageData(momentumImage, 0, 0);
    time = sim.time;
    remaining = sim.norm();
  }

  function drawReal(pixels: Uint8ClampedArray, palette: Palette) {
    const { re, im, shape } = sim;
    let peak = peakDensity(re, im);
    // Every reset is followed by a draw at time 0, which is where the starting peak is captured.
    if (sim.time === 0) {
      startPeak = peak;
    }
    peak = Math.max(peak, REAL_FLOOR * startPeak);
    paintField(pixels, re, im, peak, view, palette);
    for (let i = 0; i < shape.length; i++) {
      if (shape[i] !== 0) {
        tintPixel(pixels, i, shape[i] > 0 ? palette.wall : palette.well, 0.45 * Math.abs(shape[i]));
      }
    }
  }

  function drawMomentum(pixels: Uint8ClampedArray, ramp: Uint8ClampedArray) {
    sim.momentumDensity(momentum);
    let peak = 0;
    for (let i = 0; i < momentum.length; i++) {
      peak = Math.max(peak, momentum[i]);
    }
    if (sim.time === 0) {
      startMomentumPeak = peak;
    }
    peak = Math.max(peak, MOMENTUM_FLOOR * startMomentumPeak);
    for (let i = 0; i < momentum.length; i++) {
      const level = peak > 0 ? 1 + Math.log10(momentum[i] / peak + 1e-30) / K_DECADES : 0;
      const j = Math.round(Math.max(0, level) * 255) * 3;
      const p = i * 4;
      pixels[p] = ramp[j];
      pixels[p + 1] = ramp[j + 1];
      pixels[p + 2] = ramp[j + 2];
      pixels[p + 3] = 255;
    }
  }

  function restart() {
    sim.reset(params);
    draw();
  }

  function togglePlay() {
    if (finished) {
      restart();
      playing = true;
    } else {
      playing = !playing;
    }
  }

  onMount(() => {
    realImage = new ImageData(N, N);
    momentumImage = new ImageData(N, N);
    realContext = realCanvas.getContext('2d');
    momentumContext = momentumCanvas.getContext('2d');

    // Play once on first scroll into view.
    return watchVisibility(
      root,
      (onScreen) => (visible = onScreen),
      () => (playing = true),
    );
  });

  // Any parameter change starts the packet over. Untracked so a view switch
  // (which draw reads) redraws without restarting.
  $effect(() => {
    sim.reset(params);
    untrack(draw);
  });

  // Rebuild the colormaps when the site theme changes.
  $effect(() => {
    void theme.current;
    readColors();
    untrack(draw);
  });

  // Redraw on a view switch.
  $effect(() => {
    void view;
    untrack(draw);
  });

  $effect(() => {
    if (finished) {
      playing = false;
    }
  });

  // Only animate while playing and on screen.
  $effect(() => {
    if (!playing || !visible) {
      return;
    }
    return runFrames(FRAME_MS, () => {
      sim.step(STEPS_PER_FRAME);
      draw();
    });
  });
</script>

<div class="demo" bind:this={root}>
  <div class="panels">
    <figure>
      <div
        class="view"
        role="img"
        aria-label="Real-space view of the wave packet and the scatterer"
      >
        <canvas width={N} height={N} bind:this={realCanvas}></canvas>
      </div>
      <figcaption>
        Real space: {view === 'density'
          ? 'probability density'
          : 'phase (fades where amplitude is small)'}
      </figcaption>
    </figure>
    <figure>
      <div class="view momentum" role="img" aria-label="Momentum-space view of the wave packet">
        <canvas width={N} height={N} bind:this={momentumCanvas}></canvas>
        <svg viewBox="0 0 {N} {N}" aria-hidden="true">
          <circle cx={N / 2 + 0.5} cy={N / 2 + 0.5} r={ringRadius} />
        </svg>
      </div>
      <figcaption>Momentum space (log scale); dashed ring is |k| = k₀</figcaption>
    </figure>
  </div>

  <div class="actions">
    <button type="button" onclick={togglePlay}>
      {finished ? 'Replay' : playing ? 'Pause' : 'Play'}
    </button>
    <button type="button" onclick={restart}>Restart</button>
    <p class="readout">
      t = {time.toFixed(0)} · in box: {(remaining * 100).toFixed(1)}%
    </p>
  </div>

  <div class="controls">
    <label>
      <span>Scatterer</span>
      <select bind:value={scatterer}>
        {#each SCATTERERS as option (option)}
          <option value={option}>{SCATTERER_LABELS[option]}</option>
        {/each}
      </select>
    </label>

    <fieldset>
      <legend>View</legend>
      <label class="inline"><input type="radio" bind:group={view} value="density" /> Density</label>
      <label class="inline"><input type="radio" bind:group={view} value="phase" /> Phase</label>
    </fieldset>

    <label>
      <span>Momentum k₀ = {k0.toFixed(2)}</span>
      <input type="range" min="0.4" max="1.6" step="0.05" bind:value={k0} />
    </label>

    <label>
      <span>Packet width σ = {sigma}</span>
      <input type="range" min="4" max="10" step="1" bind:value={sigma} />
    </label>

    <label>
      <span>
        Height V₀ / E = {wallFixed
          ? `${DOUBLE_SLIT.wallBarrier.toFixed(1)} (fixed for the double slit)`
          : barrier.toFixed(1)}
      </span>
      <input type="range" min="-2" max="4" step="0.25" bind:value={barrier} disabled={wallFixed} />
    </label>
  </div>
</div>

<style>
  .panels {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .momentum {
    position: relative;
  }

  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  circle {
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    vector-effect: non-scaling-stroke;
  }

  /* Side by side, each view would be only ~150px wide on a phone. */
  @media (max-width: 520px) {
    .panels {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
