// Browser detection and the fact lists shown on the About You page. No DOM or
// Vite globals here, so the logic can be unit-tested; readBrowser() is in browser.ts.
import type { InteractionState } from './interactionStore';

// Response of /api/about-you/request-context/.
export type RequestContextSnapshot = {
  timestamp: string;
  request: {
    method: string;
    path: string;
  };
  network: {
    clientIp: string;
    ipSource: string;
    hasForwardedHeaders: boolean;
  };
  geolocation: {
    available: boolean;
    reason?: string;
    provider?: string;
    country?: string;
    region?: string;
    city?: string;
    postal?: string;
    timezone?: string;
    latitude?: number | null;
    longitude?: number | null;
  };
  headers: {
    userAgent: string;
    acceptLanguage: string;
    referer: string;
    doNotTrack: string;
  };
};

export type Fact = {
  label: string;
  value: string;
  note?: string;
  // Dims the value, e.g. for unavailable or deliberately uncollected data.
  muted?: boolean;
};

export type BrowserNavigator = {
  userAgent: string;
  userAgentData?: {
    brands?: Array<{ brand: string; version: string }>;
    platform?: string;
  };
};

export type BrowserInfo = {
  name: string;
  os?: string;
  userAgent: string;
  brands: string[];
  platform?: string;
  languages: readonly string[];
  timezone: string;
  screen: string;
  viewport: string;
  pixelRatio: number;
  touchPoints: number;
  cpuCores?: number;
  deviceMemory?: number;
  connectionType?: string;
  online: boolean;
  doNotTrack: string;
  cookiesEnabled: boolean;
  prefersDark: boolean;
  prefersReducedMotion: boolean;
  referrer: string;
};

const UNAVAILABLE = 'Unavailable';

export const NOT_COLLECTED: Fact[] = [
  {
    label: 'Persistent ID',
    value: 'No user ID or tracking cookie is created for this page.',
  },
  {
    label: 'Analytics Profile',
    value: 'No external analytics tracker is loaded here.',
  },
  {
    label: 'Fingerprint',
    value: 'No multi-signal browser fingerprint is generated.',
  },
];

// Checked in order; the first match names the browser. Edge and Chrome UAs
// also contain "Chrome/" and "Safari/", so the more specific patterns go first.
const UA_BROWSERS: [name: string, pattern: RegExp][] = [
  ['Edge', /Edg\/(\d+)/],
  ['Firefox', /Firefox\/(\d+)/],
  ['Chrome', /Chrome\/(\d+)/],
  ['Safari', /Version\/(\d+).*Safari/],
];

export function describeBrowser(nav: BrowserNavigator): string {
  const brands = (nav.userAgentData?.brands ?? []).filter(
    (brand) => !/not.?a.?brand/i.test(brand.brand),
  );
  const brand = brands.find((b) => b.brand !== 'Chromium') ?? brands[0] ?? null;
  if (brand) {
    return `${brand.brand} ${brand.version}`;
  }

  for (const [name, pattern] of UA_BROWSERS) {
    const match = nav.userAgent.match(pattern);
    if (match) {
      return `${name} ${match[1]}`;
    }
  }
  return 'an unrecognized browser';
}

export function toDisplayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return UNAVAILABLE;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : UNAVAILABLE;
  }
  return String(value);
}

export function fact(label: string, value: unknown, note?: string): Fact {
  const display = toDisplayValue(value);
  return { label, value: display, note, muted: display === UNAVAILABLE };
}

export function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return 'None yet';
  }
  return entries.map(([key, count]) => `${key} ×${count}`).join(', ');
}

export function countryName(code: string | undefined): string {
  if (!code) {
    return '';
  }
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function deviceFacts(browser: BrowserInfo): Fact[] {
  return [
    fact('Platform', browser.platform),
    fact('Screen', browser.screen),
    fact('Window', browser.viewport),
    fact('Pixel Ratio', browser.pixelRatio),
    fact('Touch Points', browser.touchPoints),
    fact('CPU Cores', browser.cpuCores, 'Reported by the browser as a hint.'),
    fact(
      'Memory',
      browser.deviceMemory && `~${browser.deviceMemory} GB`,
      'Rounded hint; only some browsers expose it.',
    ),
  ];
}

export function browserFacts(browser: BrowserInfo): Fact[] {
  return [
    fact('Browser', browser.name),
    fact('User Agent', browser.userAgent, 'Raw browser user-agent string.'),
    fact(
      'Client Hint Brands',
      browser.brands,
      'Only available in some browsers; often privacy-limited.',
    ),
    fact('Cookies', browser.cookiesEnabled ? 'Enabled' : 'Disabled'),
    fact('Do Not Track', browser.doNotTrack),
    fact('Connection', browser.connectionType, 'Estimated, not measured.'),
    fact('Online', browser.online ? 'Yes' : 'No'),
  ];
}

export function preferenceFacts(browser: BrowserInfo): Fact[] {
  return [
    fact('Languages', browser.languages),
    fact('Timezone', browser.timezone),
    fact('Color Scheme', browser.prefersDark ? 'Dark' : 'Light'),
    fact('Reduced Motion', browser.prefersReducedMotion ? 'Reduce' : 'No preference'),
  ];
}

export function visitFacts(browser: BrowserInfo, visit: InteractionState): Fact[] {
  return [
    fact('Tab Opened', new Date(visit.sessionStartedAt).toLocaleString()),
    fact('Arrived From', browser.referrer || 'Direct visit or no referrer'),
    fact('Previous Page', visit.previousRoute ?? 'None'),
    fact('Pages Viewed', formatCounts(visit.routeVisitCounts)),
    fact('Projects Viewed', formatCounts(visit.projectViews)),
  ];
}

export function hasCoordinates(geo: RequestContextSnapshot['geolocation']): boolean {
  return typeof geo.latitude === 'number' && typeof geo.longitude === 'number';
}

export function serverFacts(context: RequestContextSnapshot): Fact[] {
  const { request, network, headers, geolocation } = context;
  const coordinates =
    geolocation.available && hasCoordinates(geolocation)
      ? `${geolocation.latitude}, ${geolocation.longitude}`
      : null;

  return [
    fact('IP Address', network.clientIp, `Source: ${network.ipSource}`),
    fact('Via Proxy', network.hasForwardedHeaders ? 'Yes (forwarded headers)' : 'No'),
    ...(geolocation.available
      ? [
          fact('Country', countryName(geolocation.country)),
          fact('Region', geolocation.region),
          fact('City', geolocation.city),
          fact('Postal Code', geolocation.postal),
          fact('Timezone', geolocation.timezone),
          fact(
            'Coordinates',
            coordinates,
            `Approximate, looked up by ${geolocation.provider ?? 'the edge network'}.`,
          ),
        ]
      : [fact('Geolocation', null, geolocation.reason || 'Lookup not available.')]),
    fact('Request', `${request.method} ${request.path}`, context.timestamp),
    fact('User-Agent Header', headers.userAgent),
    fact('Accept-Language', headers.acceptLanguage),
    fact('Referer Header', headers.referer),
    fact('DNT Header', headers.doNotTrack),
  ];
}
