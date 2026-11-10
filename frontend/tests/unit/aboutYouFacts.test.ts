import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  countryName,
  describeBrowser,
  fact,
  formatCounts,
  type RequestContextSnapshot,
  serverFacts,
  toDisplayValue,
} from '../../src/lib/aboutYou/facts.ts';

const UA = {
  chrome:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
};

describe('describeBrowser', () => {
  test('falls back to the user agent, checking specific browsers first', () => {
    assert.equal(describeBrowser({ userAgent: UA.edge }), 'Edge 130');
    assert.equal(describeBrowser({ userAgent: UA.chrome }), 'Chrome 130');
    assert.equal(describeBrowser({ userAgent: UA.firefox }), 'Firefox 132');
    assert.equal(describeBrowser({ userAgent: UA.safari }), 'Safari 18');
    assert.equal(describeBrowser({ userAgent: 'curl/8.0' }), 'an unrecognized browser');
  });

  test('prefers a client-hint brand, skipping GREASE and Chromium', () => {
    const userAgentData = {
      brands: [
        { brand: 'Not?A_Brand', version: '99' },
        { brand: 'Chromium', version: '130' },
        { brand: 'Brave', version: '130' },
      ],
    };
    assert.equal(describeBrowser({ userAgent: UA.chrome, userAgentData }), 'Brave 130');
  });

  test('uses Chromium when it is the only real brand', () => {
    const userAgentData = { brands: [{ brand: 'Chromium', version: '130' }] };
    assert.equal(describeBrowser({ userAgent: UA.chrome, userAgentData }), 'Chromium 130');
  });
});

describe('fact values', () => {
  test('missing and empty values read as Unavailable and are muted', () => {
    for (const value of [null, undefined, '', []]) {
      assert.equal(toDisplayValue(value), 'Unavailable');
    }
    assert.equal(fact('X', null).muted, true);
    assert.equal(fact('X', 0).value, '0');
    assert.equal(fact('X', ['en', 'fr']).value, 'en, fr');
    assert.equal(fact('X', 'ok').muted, false);
  });

  test('formatCounts', () => {
    assert.equal(formatCounts({}), 'None yet');
    assert.equal(formatCounts({ '/': 2, '/about': 1 }), '/ ×2, /about ×1');
  });

  test('countryName', () => {
    assert.equal(countryName(undefined), '');
    assert.equal(countryName('US'), 'United States');
  });
});

describe('serverFacts', () => {
  const base: RequestContextSnapshot = {
    timestamp: '2026-11-10T00:00:00Z',
    request: { method: 'GET', path: '/api/about-you/request-context/' },
    network: { clientIp: '203.0.113.5', ipSource: 'CF-Connecting-IP', hasForwardedHeaders: true },
    geolocation: { available: false, reason: 'No lookup in dev.' },
    headers: { userAgent: UA.firefox, acceptLanguage: 'en-US', referer: '', doNotTrack: '' },
  };
  const labels = (facts: { label: string }[]) => facts.map((f) => f.label);

  test('without geolocation shows one Geolocation row with the reason', () => {
    const facts = serverFacts(base);
    const geo = facts.find((f) => f.label === 'Geolocation');
    assert.equal(geo?.note, 'No lookup in dev.');
    assert.ok(!labels(facts).includes('Coordinates'));
  });

  test('with geolocation lists location rows and coordinates', () => {
    const facts = serverFacts({
      ...base,
      geolocation: { available: true, country: 'US', latitude: 40.7, longitude: -74 },
    });
    assert.ok(!labels(facts).includes('Geolocation'));
    assert.equal(facts.find((f) => f.label === 'Coordinates')?.value, '40.7, -74');
    assert.equal(facts.find((f) => f.label === 'Country')?.value, 'United States');
  });

  test('missing coordinates read as Unavailable', () => {
    const facts = serverFacts({
      ...base,
      geolocation: { available: true, latitude: null, longitude: null },
    });
    assert.equal(facts.find((f) => f.label === 'Coordinates')?.muted, true);
  });
});
