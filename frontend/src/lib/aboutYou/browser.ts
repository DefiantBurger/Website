import { describeBrowser, type BrowserInfo, type BrowserNavigator } from './facts';

type NavigatorExtras = Navigator &
  BrowserNavigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string };
  };

export function readBrowser(): BrowserInfo {
  const nav = navigator as NavigatorExtras;
  const win = window as Window & { doNotTrack?: string };

  return {
    name: describeBrowser(nav),
    os: nav.userAgentData?.platform || nav.platform,
    userAgent: nav.userAgent,
    brands: nav.userAgentData?.brands?.map((brand) => `${brand.brand} ${brand.version}`) ?? [],
    languages: nav.languages,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${window.screen.width} × ${window.screen.height}`,
    viewport: `${window.innerWidth} × ${window.innerHeight}`,
    pixelRatio: window.devicePixelRatio,
    touchPoints: nav.maxTouchPoints,
    cpuCores: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    connectionType: nav.connection?.effectiveType,
    online: navigator.onLine,
    doNotTrack: nav.doNotTrack || win.doNotTrack || 'Not set',
    cookiesEnabled: nav.cookieEnabled,
    prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    referrer: document.referrer,
  };
}
