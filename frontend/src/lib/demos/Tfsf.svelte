<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { theme } from '../theme.svelte';
  import { parseColor, type Rgb } from './colormap';
  import './demo.css';
  import {
    paintField,
    readFieldPalette,
    tintPixel,
    type FieldPalette,
    type FieldView,
  } from './fieldImage';
  import { runFrames, watchVisibility } from './playback';
  import {
    BOX,
    TfsfSim,
    absorbMargin,
    clampVertex,
    regularPolygon,
    type IncidentWave,
    type Point,
  } from './tfsf';

  const N = 128;
  // The absorbing layer is cropped off: only the cells inside it are drawn.
  const MARGIN = absorbMargin(N);
  const V = N - 2 * MARGIN;
  // 30 fps; at k0 = 1 the scattered wave reaches the edge of the view in about 2 s.
  const FRAME_MS = 1000 / 30;
  const STEPS_PER_FRAME = 3;
  // Fixed brightness scales (peak |ψ|), so the steady pattern doesn't flicker as the
  // peak moves. The scattered view saturates inside the box to keep the weaker
  // scattered wave outside it visible.
  const PEAK = { scattered: 1, total: 2 };
  // Arrow keys move a focused corner this many cells (Shift: more).
  const KEY_STEP = 1;
  const KEY_STEP_FAST = 4;

  const DEFAULTS = { k0: 1, angle: 0, barrier: 3, sides: 3 };

  let k0 = $state(DEFAULTS.k0);
  let angle = $state(DEFAULTS.angle);
  let barrier = $state(DEFAULTS.barrier);
  let sides = $state(DEFAULTS.sides);
  let vertices = $state<Point[]>(regularPolygon(DEFAULTS.sides, N));
  let scatteredOnly = $state(true);
  let view = $state<FieldView>('density');
  let playing = $state(false);
  let visible = $state(false);
  let time = $state(0);
  let dragging = $state<number | null>(null);

  let root: HTMLElement;
  let canvas: HTMLCanvasElement;
  let overlay: SVGSVGElement;
  let image: ImageData | undefined;
  let context: CanvasRenderingContext2D | null = null;
  let colors: (FieldPalette & { wall: Rgb; well: Rgb }) | undefined;

  const wave = $derived<IncidentWave>({ k0, angle: (angle * Math.PI) / 180 });
  const sim = new TfsfSim(
    N,
    untrack(() => wave),
    { vertices: $state.snapshot(untrack(() => vertices)), barrier: untrack(() => barrier) },
  );
  const fieldRe = new Float64Array(N * N);
  const fieldIm = new Float64Array(N * N);
  const viewRe = new Float64Array(V * V);
  const viewIm = new Float64Array(V * V);

  // Grid cell x sits at the center of view pixel x - MARGIN.
  const toView = (cell: number) => cell - MARGIN + 0.5;
  const boxStart = toView(BOX.min * N);
  const boxSize = (BOX.max - BOX.min) * N;
  const outline = $derived(vertices.map((p) => `${toView(p.x)},${toView(p.y)}`).join(' '));
  // Direction marker for the incoming wave, in the scattered-field strip left of the box.
  const arrow = $derived.by(() => {
    const length = 7;
    const dx = Math.cos(wave.angle);
    const dy = Math.sin(wave.angle);
    const cx = boxStart / 2;
    const cy = V / 2;
    const tip = { x: cx + (dx * length) / 2, y: cy + (dy * length) / 2 };
    const head = (turn: number) =>
      `${tip.x - 2.5 * Math.cos(wave.angle + turn)},${tip.y - 2.5 * Math.sin(wave.angle + turn)}`;
    return {
      shaft: `M ${cx - (dx * length) / 2} ${cy - (dy * length) / 2} L ${tip.x} ${tip.y}`,
      head: `${head(0.5)} ${tip.x},${tip.y} ${head(-0.5)}`,
    };
  });

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
    if (!colors || !image) {
      return;
    }
    let re = sim.re;
    let im = sim.im;
    if (!scatteredOnly) {
      sim.totalField(fieldRe, fieldIm);
      re = fieldRe;
      im = fieldIm;
    }
    for (let y = 0; y < V; y++) {
      const from = (y + MARGIN) * N + MARGIN;
      viewRe.set(re.subarray(from, from + V), y * V);
      viewIm.set(im.subarray(from, from + V), y * V);
    }
    const peak = scatteredOnly ? PEAK.scattered : PEAK.total;
    paintField(image.data, viewRe, viewIm, peak * peak, view, colors);
    for (let y = 0; y < V; y++) {
      for (let x = 0; x < V; x++) {
        const s = sim.shape[(y + MARGIN) * N + x + MARGIN];
        if (s !== 0) {
          tintPixel(image.data, y * V + x, s > 0 ? colors.wall : colors.well, 0.45 * Math.abs(s));
        }
      }
    }
    context?.putImageData(image, 0, 0);
    time = sim.time;
  }

  function restart() {
    sim.reset(wave);
    draw();
  }

  function setSides(count: number) {
    sides = count;
    vertices = regularPolygon(count, N);
  }

  function moveVertex(index: number, to: Point) {
    vertices[index] = clampVertex(to, N);
  }

  function pointerCell(event: PointerEvent): Point {
    const rect = overlay.getBoundingClientRect();
    const scale = V / rect.width;
    return {
      x: (event.clientX - rect.left) * scale + MARGIN - 0.5,
      y: (event.clientY - rect.top) * scale + MARGIN - 0.5,
    };
  }

  function startDrag(event: PointerEvent, index: number) {
    if (event.button !== 0) {
      return;
    }
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    dragging = index;
    event.preventDefault();
  }

  function drag(event: PointerEvent, index: number) {
    if (dragging === index) {
      moveVertex(index, pointerCell(event));
    }
  }

  function nudge(event: KeyboardEvent, index: number) {
    const step = event.shiftKey ? KEY_STEP_FAST : KEY_STEP;
    const offsets: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const offset = offsets[event.key];
    if (offset) {
      event.preventDefault();
      const p = vertices[index];
      moveVertex(index, { x: p.x + offset[0], y: p.y + offset[1] });
    }
  }

  onMount(() => {
    image = new ImageData(V, V);
    context = canvas.getContext('2d');
    // Play once on first scroll into view.
    return watchVisibility(
      root,
      (onScreen) => (visible = onScreen),
      () => (playing = true),
    );
  });

  // A new incident wave starts over; the potential's height follows its energy.
  $effect(() => {
    void wave;
    untrack(restart);
  });

  // A reshaped scatterer takes effect without restarting.
  $effect(() => {
    const scatterer = { vertices: $state.snapshot(vertices), barrier };
    untrack(() => {
      sim.setScatterer(scatterer);
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
    void scatteredOnly;
    untrack(draw);
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
  <div class="layout">
    <figure>
      <div class="view">
        <!-- The handles sit outside the role="img" element, which can't hold interactive content. -->
        <div
          role="img"
          aria-label="A plane wave scattering off a polygon, with the wave's total-field region marked by a dashed box"
        >
          <canvas width={V} height={V} bind:this={canvas}></canvas>
        </div>
        <svg viewBox="0 0 {V} {V}" bind:this={overlay}>
          <rect class="box" x={boxStart} y={boxStart} width={boxSize} height={boxSize} />
          <g class="arrow" aria-hidden="true">
            <path d={arrow.shaft} />
            <polyline points={arrow.head} />
          </g>
          <polygon class="outline" points={outline} />
          {#each vertices as vertex, index (index)}
            <g
              class="handle"
              class:active={dragging === index}
              transform="translate({toView(vertex.x)} {toView(vertex.y)})"
              role="button"
              tabindex="0"
              aria-label="Corner {index +
                1} of the scatterer: drag, or use the arrow keys, to move it"
              onpointerdown={(event) => startDrag(event, index)}
              onpointermove={(event) => drag(event, index)}
              onpointerup={() => (dragging = null)}
              onpointercancel={() => (dragging = null)}
              onkeydown={(event) => nudge(event, index)}
            >
              <!-- The visible dot is small; the invisible ring around it is the touch target. -->
              <circle class="hit" r="5" />
              <circle class="dot" r="2.2" />
            </g>
          {/each}
        </svg>
      </div>
      <figcaption aria-live="polite">
        {scatteredOnly
          ? 'Inside the dashed box: incident plus scattered wave. Outside it: the scattered wave alone.'
          : 'Total field: the incident plane wave plus the scattered wave, everywhere.'}
        Drag the corners to reshape the scatterer.
      </figcaption>
    </figure>

    <div class="side">
      <div class="actions">
        <button type="button" onclick={() => (playing = !playing)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onclick={restart}>Restart</button>
        <p class="readout">t = {time.toFixed(0)}</p>
      </div>

      <div class="controls">
        <label class="inline">
          <input type="checkbox" bind:checked={scatteredOnly} />
          Only scattered field outside the box
        </label>

        <fieldset>
          <legend>View</legend>
          <label class="inline"
            ><input type="radio" bind:group={view} value="density" /> Density</label
          >
          <label class="inline"><input type="radio" bind:group={view} value="phase" /> Phase</label>
        </fieldset>

        <label>
          <span>Sides (resets the shape)</span>
          <select value={sides} onchange={(event) => setSides(Number(event.currentTarget.value))}>
            {#each [3, 4, 5, 6, 7] as count (count)}
              <option value={count}>{count}</option>
            {/each}
          </select>
        </label>

        <label>
          <span>Height V₀ / E = {barrier.toFixed(2)}</span>
          <input type="range" min="-2" max="4" step="0.25" bind:value={barrier} />
        </label>

        <label>
          <span>Momentum k₀ = {k0.toFixed(2)}</span>
          <input type="range" min="0.5" max="1.5" step="0.05" bind:value={k0} />
        </label>

        <label>
          <span>Angle = {angle}°</span>
          <input type="range" min="-45" max="45" step="5" bind:value={angle} />
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

  .view {
    position: relative;
  }

  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    /* Only the corner handles take the pointer; the rest of the view scrolls the page. */
    pointer-events: none;
  }

  .box,
  .outline,
  .arrow * {
    fill: none;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .box {
    stroke: var(--color-text-primary);
    stroke-dasharray: 4 3;
  }

  .outline {
    stroke: var(--color-text-muted);
  }

  .arrow * {
    stroke: var(--color-text-primary);
    stroke-width: 2;
  }

  .handle {
    pointer-events: all;
    cursor: grab;
    /* Dragging a corner on a touch screen shouldn't scroll the page. */
    touch-action: none;
  }

  .handle.active {
    cursor: grabbing;
  }

  .hit {
    fill: transparent;
  }

  .dot {
    fill: var(--color-accent);
    stroke: var(--color-bg-surface);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }

  .handle:focus-visible {
    outline: none;
  }

  .handle:focus-visible .dot,
  .handle.active .dot {
    stroke: var(--color-text-primary);
    stroke-width: 2.5;
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
