<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { theme } from '../theme.svelte';
  import { AbsorbingBox, ExactBox, type Boundary, type BoxPacket } from './boundaries';
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

  const N = 128;
  // 30 fps, advancing 0.75 time units (one absorbing-box step) per frame; at k0 = 1
  // the packet reaches the wall in about 3 s.
  const FRAME_MS = 1000 / 30;
  const FRAME_TIME = 0.75;
  // The run ends once the packet has had time to reach a wall and come back.
  const END_DISTANCE = 1.3 * N;
  // The view scales to the current peak, but never above this fraction of the
  // starting peak, so a spread-out or absorbed packet fades instead of glowing.
  const PEAK_FLOOR = 0.05;

  const OPTIONS: { value: Boundary; label: string; caption: string }[] = [
    {
      value: 'periodic',
      label: 'Periodic (FFT)',
      caption:
        'The box wraps around, so the packet leaves through one wall and comes back through the opposite one.',
    },
    {
      value: 'dirichlet',
      label: 'Dirichlet (sine)',
      caption:
        'ψ = 0 at the walls. Reflection flips the sign of the wave, so incoming and reflected waves cancel along the wall.',
    },
    {
      value: 'neumann',
      label: 'Neumann (cosine)',
      caption:
        'ψ has zero slope at the walls. Reflection keeps the sign, so incoming and reflected waves add up along the wall.',
    },
    {
      value: 'absorbing',
      label: 'Absorbing layer',
      caption:
        'A negative imaginary potential near the edges (shaded) drains the packet instead of reflecting it.',
    },
  ];

  const DEFAULTS = { k0: 1, sigma: 8, angle: 25 };

  let boundary = $state<Boundary>('dirichlet');
  let k0 = $state(DEFAULTS.k0);
  let sigma = $state(DEFAULTS.sigma);
  let angle = $state(DEFAULTS.angle);
  let view = $state<FieldView>('density');
  let playing = $state(false);
  let visible = $state(false);
  let time = $state(0);
  let remaining = $state(1);

  let root: HTMLElement;
  let canvas: HTMLCanvasElement;
  let image: ImageData | undefined;
  let context: CanvasRenderingContext2D | null = null;
  let colors: (FieldPalette & { layer: Rgb }) | undefined;

  const packet = $derived<BoxPacket>({ k0, sigma, angle: (angle * Math.PI) / 180 });
  const caption = $derived(OPTIONS.find((option) => option.value === boundary)?.caption);
  const finished = $derived(time >= END_DISTANCE / k0);

  // All boxes share one clock, so switching boundaries keeps the current moment. The
  // absorbing box has to step, so it advances every frame even while another box is
  // shown; the others are exact at any time and only compute when shown.
  let clock = 0;
  let startPeak = 0;
  const absorbing = new AbsorbingBox(
    N,
    untrack(() => packet),
  );
  let walls = new ExactBox(
    N,
    'dirichlet',
    untrack(() => packet),
  );

  function shown(): AbsorbingBox | ExactBox {
    return boundary === 'absorbing' ? absorbing : walls;
  }

  function readColors() {
    const style = getComputedStyle(root);
    colors = {
      ...readFieldPalette(style),
      layer: parseColor(style.getPropertyValue('--color-text-muted')),
    };
  }

  function draw() {
    if (!colors || !image) {
      return;
    }
    const box = shown();
    const peak = Math.max(peakDensity(box.re, box.im), PEAK_FLOOR * startPeak);
    paintField(image.data, box.re, box.im, peak, view, colors);
    if (box === absorbing) {
      for (let i = 0; i < N * N; i++) {
        if (absorbing.layer[i] > 0) {
          tintPixel(image.data, i, colors.layer, 0.35 * absorbing.layer[i]);
        }
      }
    }
    context?.putImageData(image, 0, 0);
    time = clock;
    remaining = box.norm();
  }

  function restart() {
    clock = 0;
    absorbing.reset(packet);
    walls.reset(packet);
    startPeak = peakDensity(absorbing.re, absorbing.im);
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
    image = new ImageData(N, N);
    context = canvas.getContext('2d');
    // Play once on first scroll into view.
    return watchVisibility(
      root,
      (onScreen) => (visible = onScreen),
      () => (playing = true),
    );
  });

  // A new packet starts over.
  $effect(() => {
    void packet;
    untrack(restart);
  });

  // A new boundary picks up at the same moment.
  $effect(() => {
    const next = boundary;
    untrack(() => {
      if (next !== 'absorbing') {
        if (walls.boundary !== next) {
          walls = new ExactBox(N, next, packet);
        }
        walls.advanceTo(clock);
      }
      draw();
    });
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
      clock += FRAME_TIME;
      absorbing.advanceTo(clock);
      if (boundary !== 'absorbing') {
        walls.advanceTo(clock);
      }
      draw();
    });
  });
</script>

<div class="demo" bind:this={root}>
  <div class="layout">
    <figure>
      <div
        class="view"
        class:hard={boundary === 'dirichlet' || boundary === 'neumann'}
        class:open={boundary === 'periodic'}
        role="img"
        aria-label="A wave packet in a box, reaching the box's right wall"
      >
        <canvas width={N} height={N} bind:this={canvas}></canvas>
      </div>
      <figcaption aria-live="polite">{caption}</figcaption>
    </figure>

    <div class="side">
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
        <fieldset>
          <legend>Boundary</legend>
          {#each OPTIONS as option (option.value)}
            <label class="inline">
              <input type="radio" bind:group={boundary} value={option.value} />
              {option.label}
            </label>
          {/each}
        </fieldset>

        <fieldset>
          <legend>View</legend>
          <label class="inline"
            ><input type="radio" bind:group={view} value="density" /> Density</label
          >
          <label class="inline"><input type="radio" bind:group={view} value="phase" /> Phase</label>
        </fieldset>

        <label>
          <span>Momentum k₀ = {k0.toFixed(2)}</span>
          <input type="range" min="0.5" max="1.5" step="0.05" bind:value={k0} />
        </label>

        <label>
          <span>Packet width σ = {sigma}</span>
          <input type="range" min="4" max="10" step="1" bind:value={sigma} />
        </label>

        <label>
          <span>Angle = {angle}°</span>
          <input type="range" min="0" max="60" step="5" bind:value={angle} />
        </label>
      </div>
    </div>
  </div>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 30rem) minmax(14rem, 18rem);
    gap: 1.5rem;
    align-items: start;
  }

  /* The border stands in for the wall: solid for a hard wall, dashed for a box that wraps. */
  .view.hard {
    border: 2px solid var(--color-text-primary);
  }

  .view.open {
    border-style: dashed;
  }

  .side .actions {
    margin-top: 0;
  }

  .side .controls {
    grid-template-columns: minmax(0, 1fr);
  }

  @media (max-width: 640px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }

    .side .actions {
      margin-top: 1rem;
    }
  }
</style>
