// Animation timing and autoplay shared by the demos.

/**
 * Call `onFrame` every `frameMs` until the returned function is called. Paced by
 * elapsed time, not display frames, so every refresh rate runs at the same speed.
 */
export function runFrames(frameMs: number, onFrame: () => void): () => void {
  let previous: number | undefined;
  let owed = 0;
  let frame = requestAnimationFrame(function tick(now) {
    frame = requestAnimationFrame(tick);
    owed += previous === undefined ? frameMs : Math.min(now - previous, 100);
    previous = now;
    // 2 ms of slack so a 60 Hz display lands on every other frame despite timer jitter.
    if (owed < frameMs - 2) {
      return;
    }
    // Capped so a slow device or a stall doesn't queue a burst of catch-up frames.
    owed = Math.min(owed - frameMs, frameMs);
    onFrame();
  });
  return () => cancelAnimationFrame(frame);
}

/**
 * Report whether `root` is on screen, and call `onFirstView` the first time it is,
 * unless the reader prefers reduced motion. Returns a function that stops watching.
 */
export function watchVisibility(
  root: Element,
  onChange: (visible: boolean) => void,
  onFirstView: () => void,
): () => void {
  let seen = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const observer = new IntersectionObserver((entries) => {
    // A fast scroll can batch several entries, oldest first; only the last is current.
    const visible = entries[entries.length - 1].isIntersecting;
    onChange(visible);
    if (visible && !seen) {
      seen = true;
      onFirstView();
    }
  });
  observer.observe(root);
  return () => observer.disconnect();
}
