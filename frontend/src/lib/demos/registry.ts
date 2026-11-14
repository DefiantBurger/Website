import type { Component } from 'svelte';
import type { DemoId } from './ids';

// Dynamic imports keep each demo out of the main bundle until a page uses it.
export const DEMOS: Record<DemoId, () => Promise<{ default: Component }>> = {
  'wavepacket-2d': () => import('./Wavepacket2D.svelte'),
};
