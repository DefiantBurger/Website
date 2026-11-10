// Display formatting shared across pages. Plain module so it's unit-testable.

/** Decimal units (1 KB = 1000 B), matching how the backend states its limits. */
export function formatBytes(bytes: number, { trim = false }: { trim?: boolean } = {}): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  const formatted = `${value.toFixed(precision)} ${units[unitIndex]}`;
  // Prose reads better as "80 MB" than the fixed-precision "80.0 MB".
  return trim ? formatted.replace(/\.0+ /, ' ') : formatted;
}

/** Compact countdown style: `125` → `2m 05s`. */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`;
}

/** Rounded for prose: `600` → `10 minutes`. */
export function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** Local time of day with seconds; an unparseable string is returned unchanged. */
export function formatTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}
