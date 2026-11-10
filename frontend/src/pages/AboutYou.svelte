<script lang="ts">
  import { onMount } from 'svelte';

  import { loadRequestContextSnapshot, type RequestContextSnapshot } from '../lib/aboutYou/api';
  import {
    browserFacts,
    countryName,
    deviceFacts,
    hasCoordinates,
    NOT_COLLECTED,
    preferenceFacts,
    serverFacts,
    visitFacts,
    type Fact,
  } from '../lib/aboutYou/facts';
  import { readBrowser } from '../lib/aboutYou/browser';
  import { getInteractionSnapshot } from '../lib/aboutYou/interactionStore';
  import { AsyncTask } from '../lib/asyncTask.svelte';
  import { formatTime } from '../lib/format';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import StatusMessage from '../lib/components/StatusMessage.svelte';
  import FactList from '../lib/aboutYou/FactList.svelte';
  import LocationMap from '../lib/aboutYou/LocationMap.svelte';

  type Group = {
    title: string;
    source: string;
    facts: Fact[];
    busy?: boolean;
    error?: string | null;
  };

  let browser = $state(readBrowser());
  let interactionSnapshot = $state(getInteractionSnapshot());
  let refreshedAt = $state(new Date().toLocaleString());
  let now = $state(new Date());

  let requestContext = $state<RequestContextSnapshot | null>(null);
  const serverSnapshot = new AsyncTask('Failed to fetch request context.', { busy: true });

  const geo = $derived(requestContext?.geolocation.available ? requestContext.geolocation : null);
  const placeName = $derived(
    [geo?.city, geo?.region].filter(Boolean).join(', ') || countryName(geo?.country),
  );
  const localTime = $derived(formatTime(now));

  const groups = $derived<Group[]>([
    {
      title: 'What the Server Sees',
      source: "From your request to this site's API",
      facts: requestContext ? serverFacts(requestContext) : [],
      busy: serverSnapshot.busy,
      error: serverSnapshot.error,
    },
    {
      title: 'Your Device',
      source: 'Read by JavaScript in this tab',
      facts: deviceFacts(browser),
    },
    {
      title: 'Your Browser',
      source: 'Read by JavaScript in this tab',
      facts: browserFacts(browser),
    },
    {
      title: 'Your Preferences',
      source: 'Settings your browser shares with every site',
      facts: preferenceFacts(browser),
    },
    {
      title: 'This Visit',
      source: 'In memory only; gone when you close the tab',
      facts: visitFacts(browser, interactionSnapshot),
    },
    {
      title: 'Not Collected',
      source: 'Possible, but deliberately skipped',
      facts: NOT_COLLECTED,
    },
  ]);

  async function refreshServerSnapshot(): Promise<void> {
    await serverSnapshot.run(async () => {
      // Cleared only on failure, so the map stays mounted while a refresh loads.
      try {
        requestContext = await loadRequestContextSnapshot();
      } catch (error) {
        requestContext = null;
        throw error;
      }
    });
  }

  function refreshLocalSnapshot(): void {
    browser = readBrowser();
    interactionSnapshot = getInteractionSnapshot();
    refreshedAt = new Date().toLocaleString();
  }

  function refreshAll(): void {
    refreshLocalSnapshot();
    void refreshServerSnapshot();
  }

  onMount(() => {
    void refreshServerSnapshot();
    const clock = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(clock);
  });
</script>

<svelte:window ononline={refreshLocalSnapshot} onoffline={refreshLocalSnapshot} />

<PageHeader
  title="About You"
  description="Everything below is what this site can learn about you just from your visit. Nothing here is stored, and no analytics profile is created."
>
  <div class="snapshot">
    <p class="refresh-time">Snapshot taken {refreshedAt}</p>
    <button type="button" onclick={refreshAll}>Refresh</button>
  </div>
</PageHeader>

<section class="terminal-box hero" aria-label="Summary">
  <div class="dossier">
    <p class="prompt eyebrow">Based on your IP address, you're probably in</p>

    {#if serverSnapshot.busy}
      <p class="place">Locating you<span class="cursor">_</span></p>
    {:else if serverSnapshot.error}
      <p class="place">Somewhere</p>
      <p class="place-sub">{serverSnapshot.error}</p>
    {:else if geo && placeName}
      <p class="place">{placeName}</p>
      <p class="place-sub">
        {[countryName(geo.country), geo.postal].filter(Boolean).join(' · ')}
      </p>
    {:else}
      <p class="place">Somewhere unknown</p>
      <p class="place-sub">
        {requestContext?.geolocation.reason || "Your IP couldn't be located."}
      </p>
    {/if}

    <ul class="dossier-lines">
      {#if requestContext}
        <li>
          Your IP address is <strong>{requestContext.network.clientIp}</strong>.
        </li>
      {/if}
      <li>
        You're using <strong>{browser.name}</strong>
        {#if browser.os}on <strong>{browser.os}</strong>{/if}.
      </li>
      <li>
        Your screen is <strong>{browser.screen}</strong>
        {#if browser.cpuCores}
          and your device has <strong>{browser.cpuCores} CPU cores</strong>
          <!-- eslint-disable-next-line svelte/no-useless-mustaches -- keeps the space before "and" -->
        {/if}{#if browser.deviceMemory}{' '}and
          <strong>~{browser.deviceMemory} GB</strong> of memory{/if}.
      </li>
      <li>
        It's <strong>{localTime}</strong> where you are ({browser.timezone}){#if geo?.timezone && geo.timezone === browser.timezone},
          which matches your IP's location.{:else if geo?.timezone}, but your IP suggests <strong
            >{geo.timezone}</strong
          >. A VPN, maybe?{:else}.{/if}
      </li>
    </ul>
  </div>

  <div class="map-column">
    {#if geo && hasCoordinates(geo)}
      <LocationMap
        latitude={geo.latitude as number}
        longitude={geo.longitude as number}
        label={placeName}
      />
    {:else}
      <div class="map-placeholder">
        {serverSnapshot.busy ? 'Loading map...' : 'No coordinates to map.'}
      </div>
    {/if}
  </div>
</section>

<div class="groups">
  {#each groups as group (group.title)}
    <section class="terminal-box group">
      <h2 class="prompt section-title">{group.title}</h2>
      <p class="source">{group.source}</p>
      {#if group.busy}
        <p>Loading request context...</p>
      {:else if group.error}
        <StatusMessage kind="error" message={group.error} compact />
      {:else}
        <FactList facts={group.facts} />
      {/if}
    </section>
  {/each}
</div>

<style>
  .snapshot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    margin-top: 0.5rem;
  }

  .refresh-time {
    font-size: 0.9rem;
    opacity: 0.8;
  }

  .snapshot button {
    padding: 0.35rem 0.9rem;
    font-size: 0.85rem;
  }

  .hero {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 1.5rem;
    margin: 0 0 1.5rem;
  }

  .eyebrow {
    font-size: 0.95rem;
    opacity: 0.85;
  }

  .place {
    font-size: clamp(1.8rem, 4vw, 2.6rem);
    line-height: 1.2;
    font-weight: 700;
    color: var(--color-text-hover);
    text-shadow: 0 0 6px var(--color-primary-opacity-30);
    overflow-wrap: anywhere;
  }

  .place-sub {
    margin-bottom: 1.25rem;
    opacity: 0.85;
  }

  .cursor {
    animation: blink 1s steps(1) infinite;
  }

  .dossier-lines {
    list-style: none;
    display: grid;
    gap: 0.5rem;
    padding-top: 1rem;
    border-top: 1px dashed var(--color-primary-opacity-50);
  }

  .dossier-lines li {
    padding-left: 1.5rem;
    text-indent: -1.5rem;
    overflow-wrap: anywhere;
  }

  .dossier-lines li::before {
    content: '$ ';
    opacity: 0.6;
    display: inline-block;
    width: 1.5rem;
    text-indent: 0;
  }

  .dossier-lines strong {
    color: var(--color-text-hover);
  }

  .map-column {
    min-height: 260px;
  }

  .map-placeholder {
    height: 100%;
    min-height: 260px;
    display: grid;
    place-items: center;
    border: 1px dashed var(--color-text-primary);
    color: var(--color-text-muted);
    text-align: center;
    padding: 1rem;
  }

  /* Masonry-style columns so groups of different lengths pack tightly. */
  .groups {
    columns: 2 26rem;
    column-gap: 1.25rem;
  }

  .group {
    break-inside: avoid;
    margin: 0 0 1.25rem;
  }

  .source {
    margin-bottom: 0.5rem;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  @media (max-width: 768px) {
    .hero {
      grid-template-columns: 1fr;
    }

    .hero,
    .group {
      padding: 1rem;
    }
  }
</style>
