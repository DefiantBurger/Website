<script lang="ts">
  import { onMount } from 'svelte';

  import { loadRequestContextSnapshot, type RequestContextSnapshot } from '../lib/aboutYou/api';
  import { getInteractionSnapshot } from '../lib/aboutYou/interactionStore';

  type FieldStatus = 'available' | 'unavailable' | 'not-collected';

  type DataField = {
    label: string;
    value: string;
    status: FieldStatus;
    note?: string;
  };

  type InteractionSnapshot = ReturnType<typeof getInteractionSnapshot>;

  let browserFields: DataField[] = [];
  let interactionSnapshot: InteractionSnapshot = getInteractionSnapshot();

  let requestContext: RequestContextSnapshot | null = null;
  let requestContextError = '';
  let requestContextLoading = true;
  let showFullIp = false;

  let refreshedAt = new Date().toLocaleString();

  function toDisplayValue(value: unknown): string {
    if (value === null || value === undefined || value === '') {
      return 'Unavailable';
    }

    if (Array.isArray(value)) {
      return value.length > 0 ? value.join(', ') : 'Unavailable';
    }

    return String(value);
  }

  function field(label: string, value: unknown, note?: string): DataField {
    const display = toDisplayValue(value);
    return {
      label,
      value: display,
      status: display === 'Unavailable' ? 'unavailable' : 'available',
      note
    };
  }

  function collectBrowserFields(): DataField[] {
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: {
        effectiveType?: string;
        downlink?: number;
        rtt?: number;
      };
      userAgentData?: {
        brands?: Array<{ brand: string; version: string }>;
        mobile?: boolean;
        platform?: string;
      };
    };

    const brands = nav.userAgentData?.brands?.map((brand) => `${brand.brand} ${brand.version}`) ?? [];
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const win = window as Window & { doNotTrack?: string };

    return [
      field('User Agent', nav.userAgent, 'Raw browser user-agent string.'),
      field(
        'Browser Brands (UA Client Hints)',
        brands,
        'Only available in some browsers; often privacy-limited.'
      ),
      field('Platform', nav.platform || nav.userAgentData?.platform),
      field('Languages', nav.languages),
      field('Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone),
      field('Viewport Size', `${window.innerWidth} x ${window.innerHeight}`),
      field('Screen Size', `${window.screen.width} x ${window.screen.height}`),
      field('Pixel Ratio', window.devicePixelRatio),
      field('Touch Points', nav.maxTouchPoints),
      field('CPU Cores (Hint)', nav.hardwareConcurrency),
      field('Device Memory (Hint)', nav.deviceMemory),
      field('Connection Type', nav.connection?.effectiveType),
      field('Online Status', navigator.onLine ? 'Online' : 'Offline'),
      field('Do Not Track', nav.doNotTrack || win.doNotTrack || 'Not set'),
      field('Cookies Enabled', nav.cookieEnabled ? 'Yes' : 'No'),
      field('Preferred Color Scheme', prefersDark ? 'Dark' : 'Light'),
      field('Reduced Motion Preference', prefersReducedMotion ? 'Reduce' : 'No Preference'),
      field('Document Referrer', document.referrer || 'None')
    ];
  }

  async function refreshServerSnapshot(): Promise<void> {
    requestContextLoading = true;
    requestContextError = '';

    try {
      requestContext = await loadRequestContextSnapshot();
    } catch (error) {
      requestContextError = error instanceof Error ? error.message : 'Failed to fetch request context.';
      requestContext = null;
    } finally {
      requestContextLoading = false;
    }
  }

  function refreshLocalSnapshot(): void {
    browserFields = collectBrowserFields();
    interactionSnapshot = getInteractionSnapshot();
    refreshedAt = new Date().toLocaleString();
  }

  function statusLabel(status: FieldStatus): string {
    if (status === 'available') {
      return 'Available';
    }
    if (status === 'unavailable') {
      return 'Unavailable';
    }
    return 'Not Collected';
  }

  function toggleFullIp(): void {
    showFullIp = !showFullIp;
  }

  onMount(() => {
    refreshLocalSnapshot();
    void refreshServerSnapshot();

    const onlineListener = () => refreshLocalSnapshot();
    const offlineListener = () => refreshLocalSnapshot();

    window.addEventListener('online', onlineListener);
    window.addEventListener('offline', offlineListener);

    return () => {
      window.removeEventListener('online', onlineListener);
      window.removeEventListener('offline', offlineListener);
    };
  });
</script>

<svelte:head>
  <title>About You</title>
  <meta name="description" content="See what your browser and requests reveal during your visit. Read-only, no analytics profile created." />
</svelte:head>

<div class="page">
  <header class="page-header">
    <h1>> About You</h1>
    <p>
      This page shows what your browser and requests can reveal during your visit. It is read-only and
      does not create a new analytics profile.
    </p>
    <p class="refresh-time">Snapshot refreshed: {refreshedAt}</p>
    <button type="button" on:click={refreshLocalSnapshot}>Refresh Browser Snapshot</button>
  </header>

  <section class="terminal-box section">
    <h2>> What Your Browser Exposes Right Now</h2>
    <p class="section-intro">
      These values are available to front-end code in your current tab.
    </p>
    <div class="field-list">
      {#each browserFields as item}
        <article class="field-row">
          <div class="field-meta">
            <h3>{item.label}</h3>
            <span class="status status-{item.status}">{statusLabel(item.status)}</span>
          </div>
          <p class="value">{item.value}</p>
          {#if item.note}
            <p class="note">{item.note}</p>
          {/if}
        </article>
      {/each}
    </div>
  </section>

  <section class="terminal-box section">
    <h2>> Interaction Summary (This Tab Only)</h2>
    <p class="section-intro">
      These counters are in-memory only and reset when this tab session ends.
    </p>

    <article class="field-row">
      <div class="field-meta">
        <h3>Session Start</h3>
        <span class="status status-available">Available</span>
      </div>
      <p class="value">{interactionSnapshot.sessionStartedAt}</p>
    </article>

    <article class="field-row">
      <div class="field-meta">
        <h3>Route Context</h3>
        <span class="status status-available">Available</span>
      </div>
      <p class="value">
        Current: {interactionSnapshot.currentRoute ?? 'None'} | Previous: {interactionSnapshot.previousRoute ?? 'None'}
      </p>
    </article>

    <article class="field-row">
      <div class="field-meta">
        <h3>Route Visit Counts</h3>
        <span class="status status-available">Available</span>
      </div>
      {#if Object.keys(interactionSnapshot.routeVisitCounts).length > 0}
        <ul>
          {#each Object.entries(interactionSnapshot.routeVisitCounts) as [route, count]}
            <li>{route}: {count}</li>
          {/each}
        </ul>
      {:else}
        <p class="value">No routes tracked yet.</p>
      {/if}
    </article>

    <article class="field-row">
      <div class="field-meta">
        <h3>Project Detail Views</h3>
        <span class="status status-available">Available</span>
      </div>
      {#if Object.keys(interactionSnapshot.projectViews).length > 0}
        <ul>
          {#each Object.entries(interactionSnapshot.projectViews) as [slug, count]}
            <li>{slug}: {count}</li>
          {/each}
        </ul>
      {:else}
        <p class="value">No project detail pages viewed yet.</p>
      {/if}
    </article>

  </section>

  <section class="terminal-box section">
    <h2>> Request Metadata Visible To The Server</h2>
    <p class="section-intro">
      This snapshot comes from the current API request only.
    </p>

    {#if requestContextLoading}
      <p class="value">Loading request context...</p>
    {:else if requestContextError}
      <p class="value error">{requestContextError}</p>
    {:else if requestContext}
      <article class="field-row">
        <div class="field-meta">
          <h3>Request Line</h3>
          <span class="status status-available">Available</span>
        </div>
        <p class="value">{requestContext.request.method} {requestContext.request.path}</p>
      </article>

      <article class="field-row">
        <div class="field-meta">
          <h3>Client IP (Masked)</h3>
          <span class="status status-available">Available</span>
        </div>
        <p class="value">
          {showFullIp ? requestContext.network.clientIp : requestContext.network.clientIpMasked}
          (source: {requestContext.network.ipSource})
        </p>
        <button type="button" on:click={toggleFullIp}>
          {showFullIp ? 'Hide Full IP' : 'Show Full IP'}
        </button>
      </article>

      <article class="field-row">
        <div class="field-meta">
          <h3>Forwarded Headers Present</h3>
          <span class="status status-available">Available</span>
        </div>
        <p class="value">{requestContext.network.hasForwardedHeaders ? 'Yes' : 'No'}</p>
      </article>

      <article class="field-row">
        <div class="field-meta">
          <h3>Headers</h3>
          <span class="status status-available">Available</span>
        </div>
        <ul>
          <li>User-Agent: {requestContext.headers.userAgent || 'Unavailable'}</li>
          <li>Accept-Language: {requestContext.headers.acceptLanguage || 'Unavailable'}</li>
          <li>Referer: {requestContext.headers.referer || 'Unavailable'}</li>
          <li>Do-Not-Track: {requestContext.headers.doNotTrack || 'Unavailable'}</li>
        </ul>
        <p class="note">Snapshot timestamp: {requestContext.timestamp}</p>
      </article>

      <article class="field-row">
        <div class="field-meta">
          <h3>IP-Based Geolocation</h3>
          <span class="status status-available">Available</span>
        </div>
        {#if requestContext.geolocation.available}
          <ul>
            <li>Provider: {requestContext.geolocation.provider || 'Unavailable'}</li>
            <li>Country: {requestContext.geolocation.country || 'Unavailable'}</li>
            <li>Region: {requestContext.geolocation.region || 'Unavailable'}</li>
            <li>City: {requestContext.geolocation.city || 'Unavailable'}</li>
            <li>Postal: {requestContext.geolocation.postal || 'Unavailable'}</li>
            <li>Timezone: {requestContext.geolocation.timezone || 'Unavailable'}</li>
            <li>Latitude: {requestContext.geolocation.latitude ?? 'Unavailable'}</li>
            <li>Longitude: {requestContext.geolocation.longitude ?? 'Unavailable'}</li>
            <li>ASN: {requestContext.geolocation.asn || 'Unavailable'}</li>
            <li>Organization: {requestContext.geolocation.org || 'Unavailable'}</li>
          </ul>
        {:else}
          <p class="value">Unavailable: {requestContext.geolocation.reason || 'Lookup not available.'}</p>
        {/if}
      </article>
    {/if}

    <button type="button" on:click={refreshServerSnapshot}>Refresh Request Snapshot</button>
  </section>

  <section class="terminal-box section">
    <h2>> Possible But Not Collected By Design</h2>
    <p class="section-intro">
      The site could technically infer these, but this feature intentionally does not store or profile them.
    </p>

    <article class="field-row">
      <div class="field-meta">
        <h3>Persistent Cross-Session ID</h3>
        <span class="status status-not-collected">Not Collected</span>
      </div>
      <p class="value">No user ID is created for this page.</p>
    </article>

    <article class="field-row">
      <div class="field-meta">
        <h3>Third-Party Analytics Profile</h3>
        <span class="status status-not-collected">Not Collected</span>
      </div>
      <p class="value">No external analytics tracker is loaded here.</p>
    </article>

    <article class="field-row">
      <div class="field-meta">
        <h3>Fingerprint Score</h3>
        <span class="status status-not-collected">Not Collected</span>
      </div>
      <p class="value">No multi-signal browser fingerprint is generated.</p>
    </article>
  </section>
</div>

<style>
  .page {
    animation: fadeIn 0.5s ease-in;
  }

  @keyframes fadeIn {
    from {
      opacity: 0.5;
    }
    to {
      opacity: 1;
    }
  }

  .page-header {
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px dashed var(--color-text-primary);
  }

  .page-header h1 {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
  }

  .refresh-time {
    opacity: 0.8;
  }

  .section {
    margin-bottom: 1.2rem;
  }

  .section h2 {
    margin-top: 0;
  }

  .section-intro {
    margin-bottom: 1rem;
    opacity: 0.9;
  }

  .field-list {
    display: grid;
    gap: 0.8rem;
  }

  .field-row {
    border: 1px solid var(--color-text-primary);
    padding: 0.75rem;
  }

  .field-meta {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 0.25rem;
  }

  .field-meta h3 {
    margin: 0;
    font-size: 1.05rem;
    border: 0;
  }

  .value,
  .note {
    margin: 0.3rem 0 0;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .note {
    opacity: 0.8;
    font-size: 0.9rem;
  }

  .status {
    font-size: 0.8rem;
    border: 1px solid var(--color-text-primary);
    padding: 0.2rem 0.45rem;
    white-space: nowrap;
  }

  .status-available {
    background-color: transparent;
  }

  .status-unavailable {
    opacity: 0.75;
  }

  .status-not-collected {
    font-weight: 700;
  }

  .error {
    color: var(--color-error, #ff7a7a);
  }

  ul {
    margin: 0.4rem 0 0;
    padding-left: 1.2rem;
  }

  @media (max-width: 768px) {
    .page-header h1 {
      font-size: 1.8rem;
    }

    .field-meta {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.4rem;
    }
  }
</style>
