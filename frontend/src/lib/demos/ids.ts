// Demo ids usable in project Markdown as a ```demo fence. Plain module so the
// build plugin can validate ids without loading any Svelte components.
export const DEMO_IDS = ['wavepacket-2d'] as const;
export type DemoId = (typeof DEMO_IDS)[number];

export function isDemoId(value: string): value is DemoId {
  return (DEMO_IDS as readonly string[]).includes(value);
}
