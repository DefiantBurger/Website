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
  const { copy, anchorTop } = visibleCopy(app, height);

  const pieces = shards.map((shard) => {
    const piece = document.createElement('div');
    piece.className = 'shatter-shard';
    piece.inert = true;
    piece.style.clipPath = `polygon(${shard.polygon.map((p) => `${p.x}px ${p.y}px`).join(', ')})`;
    piece.style.transformOrigin = `${shard.center.x}px ${shard.center.y}px`;
    // Scroll a wrapper rather than translating the clone, so the sticky nav stays where it was seen.
    const page = document.createElement('div');
    page.className = 'shatter-page';
    const clone = copy.cloneNode(true) as HTMLElement;
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
  // Gutting blocks above the viewport shortened the copy, so scroll it less by however much the anchor moved.
  let scrollY = window.scrollY;
  const anchor = pieces[0]?.page.querySelector(`[${ANCHOR}]`);
  if (anchor && anchorTop !== null) {
    const { page } = pieces[0];
    // The shorter copy may clamp this scroll, so correct from where it actually landed.
    page.scrollTo(window.scrollX, scrollY);
    scrollY = page.scrollTop + anchor.getBoundingClientRect().top - anchorTop;
  }
  for (const { piece, page } of pieces) {
    page.scrollTo(window.scrollX, scrollY);
    // Clones start scrolled to the top; keep the shell showing its newest lines.
    piece.querySelector('.log')?.scrollTo(0, log?.scrollTop ?? 0);
  }
  await fall(pieces, height);
}

const ANCHOR = 'data-shatter-anchor';
// Only block-flow children are pruned: changing a flex/grid item could move its visible siblings sideways.
const FLOW = new Set(['block', 'flow-root', 'list-item']);

/**
 * A copy of `app` with the blocks outside the viewport gutted, so laying out one clone per
 * shard stays cheap on long pages. If anything above the viewport was gutted, an element
 * below it is marked as an anchor and `anchorTop` is its live viewport top.
 */
function visibleCopy(app: HTMLElement, height: number) {
  const copy = app.cloneNode(true) as HTMLElement;
  // Asserted so TS doesn't narrow it to null; it's only assigned inside the closure.
  let anchor = null as { twin: Element; top: number } | null;
  // Walks the live tree (which has layout) alongside the copy, which has the same shape.
  const prune = (live: Element, twin: Element) => {
    const flow = FLOW.has(getComputedStyle(live).display);
    const twins = [...twin.children];
    let cutAbove = false;
    [...live.children].forEach((child, i) => {
      const style = getComputedStyle(child);
      if (style.position === 'fixed' || style.position === 'sticky') {
        return;
      }
      const { top, bottom } = child.getBoundingClientRect();
      // Inline boxes share lines with visible content and floats wrap it, so both stay.
      const inline = style.display.startsWith('inline');
      const prunable = flow && !inline && style.float === 'none';
      if (prunable && top > height) {
        twins[i].remove();
      } else if (prunable && bottom < 0) {
        // An empty twin rather than none keeps :nth-child, sibling selectors, and list numbers right.
        twins[i].replaceWith(twins[i].cloneNode(false));
        cutAbove = true;
      } else {
        // Later (deeper) anchors win: they sit below every cut made so far.
        const inFlow = style.position === 'static' || style.position === 'relative';
        if (cutAbove && inFlow && bottom >= 0 && top <= height) {
          anchor = { twin: twins[i], top };
          cutAbove = false;
        }
        if (!inline) {
          prune(child, twins[i]);
        }
      }
    });
  };
  prune(app, copy);
  // Removed only after pruning, which relies on the copy matching the live tree.
  // KaTeX's MathML is invisible and a big share of the nodes; dropping it cuts the clones' layout cost.
  copy.querySelectorAll('[aria-live], .katex-mathml').forEach((node) => node.remove());
  anchor?.twin.setAttribute(ANCHOR, '');
  return { copy, anchorTop: anchor?.top ?? null };
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
