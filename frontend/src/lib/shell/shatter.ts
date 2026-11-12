// The `sudo` easter egg: the page, shell included, breaks into shards that fall off
// the screen. Each shard is a clone of #app clipped to its polygon, so it looks
// exactly like the page (the browser renders it) and the real page is never touched.
import { isGone, makeShards, step, voronoi, type Shard } from './shatterMath';

let running = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs the effect; `onReboot` fires when the visitor dismisses the crash screen. */
export async function shatter(onReboot: () => void): Promise<void> {
  const app = document.getElementById('app');
  if (running || !app) {
    return;
  }
  running = true;
  const overlay = document.createElement('div');
  overlay.className = 'shatter';
  overlay.setAttribute('aria-hidden', 'true');
  try {
    // One frame so the echoed `> sudo` renders before it's cloned, and so the
    // Enter keydown that ran the command is over before nextInteraction listens.
    await new Promise(requestAnimationFrame);
    // Reduced motion skips straight to the crash screen.
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await breakApart(app, overlay);
    }
    const message = document.createElement('p');
    message.className = 'shatter-message';
    message.textContent = 'segmentation fault (core dumped)\n';
    const hint = document.createElement('span');
    hint.textContent = 'press any key to reboot';
    message.append(hint);
    overlay.append(message);
    document.body.append(overlay);
    await nextInteraction();
    onReboot();
    overlay.style.opacity = '0';
    await sleep(400);
  } finally {
    overlay.remove();
    running = false;
  }
}

async function breakApart(app: HTMLElement, overlay: HTMLElement): Promise<void> {
  const width = document.documentElement.clientWidth;
  const height = window.innerHeight;
  const { cells } = voronoi(width, height, width < 600 ? 14 : 24, Math.random);
  const shards = makeShards(cells, { x: width / 2, y: height / 2 }, Math.random);
  const log = app.querySelector('.shell .log');

  const pieces = shards.map((shard) => {
    const piece = document.createElement('div');
    piece.className = 'shatter-shard';
    piece.inert = true;
    piece.style.clipPath = `polygon(${shard.polygon.map((p) => `${p.x}px ${p.y}px`).join(', ')})`;
    piece.style.transformOrigin = `${shard.center.x}px ${shard.center.y}px`;
    // Scroll a wrapper rather than translating the clone, so the sticky nav stays where it was seen.
    const page = document.createElement('div');
    page.className = 'shatter-page';
    const clone = app.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[aria-live]').forEach((node) => node.remove());
    page.append(clone);
    piece.append(page);
    // The fixed shell goes outside the scrolled wrapper; the transformed piece is its containing block.
    const shell = clone.querySelector('.shell');
    if (shell) {
      piece.append(shell);
    }
    overlay.append(piece);
    return { shard, piece, page };
  });
  document.body.append(overlay);
  for (const { piece, page } of pieces) {
    page.scrollTo(window.scrollX, window.scrollY);
    // Clones start scrolled to the top; keep the shell showing its newest lines.
    piece.querySelector('.log')?.scrollTo(0, log?.scrollTop ?? 0);
  }
  await fall(pieces, height);
}

function fall(pieces: { shard: Shard; piece: HTMLElement }[], height: number): Promise<void> {
  // Scaled to the viewport so the fall takes about as long on a phone as on a monitor.
  const gravity = 3 * height;
  let alive = pieces;
  let last = performance.now();
  return new Promise<void>((resolve) => {
    const frame = (now: number) => {
      // Clamped so a backgrounded tab doesn't teleport everything off screen.
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      alive = alive.filter(({ shard, piece }) => {
        step(shard, dt, gravity);
        if (isGone(shard, height)) {
          piece.remove();
          return false;
        }
        piece.style.transform = `translate(${shard.x}px, ${shard.y}px) rotate(${shard.angle}rad)`;
        return true;
      });
      if (alive.length > 0) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
}

function nextInteraction(): Promise<void> {
  const controller = new AbortController();
  return new Promise<void>((resolve) => {
    const done = () => {
      controller.abort();
      resolve();
    };
    window.addEventListener('keydown', done, { signal: controller.signal });
    window.addEventListener('pointerdown', done, { signal: controller.signal });
  });
}
