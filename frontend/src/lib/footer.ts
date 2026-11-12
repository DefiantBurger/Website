// Footer formatting. Plain module so it's unit-testable.

export type Uptime = { percent: number; days: number };

/** Truncates rather than rounds, so 99.996% never claims "100.00". */
export function formatUptime(percent: number): string {
  // The epsilon absorbs float error like 99.99 * 100 = 9998.999...
  return (Math.floor(percent * 100 + 1e-9) / 100).toFixed(2);
}

/** Commit link for a full SHA, or none when the build didn't know its commit. */
export function commitInfo(
  sha: string,
  repoUrl: string,
): { short: string; url: string | undefined } {
  return /^[0-9a-f]{7,40}$/.test(sha)
    ? { short: sha.slice(0, 7), url: `${repoUrl}/commit/${sha}` }
    : { short: 'unknown', url: undefined };
}
