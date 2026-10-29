<script lang="ts">
	import { onMount } from "svelte";

	import {
		loadRequestContextSnapshot,
		type RequestContextSnapshot,
	} from "../lib/aboutYou/api";
	import { getInteractionSnapshot } from "../lib/aboutYou/interactionStore";
	import { errorMessage } from "../lib/api";
	import PageHeader from "../lib/components/PageHeader.svelte";
	import FactList, { type Fact } from "../lib/aboutYou/FactList.svelte";
	import LocationMap from "../lib/aboutYou/LocationMap.svelte";

	type NavigatorExtras = Navigator & {
		deviceMemory?: number;
		connection?: { effectiveType?: string };
		userAgentData?: {
			brands?: Array<{ brand: string; version: string }>;
			platform?: string;
		};
	};

	const NOT_COLLECTED: Fact[] = [
		{
			label: "Persistent ID",
			value: "No user ID or tracking cookie is created for this page.",
		},
		{
			label: "Analytics Profile",
			value: "No external analytics tracker is loaded here.",
		},
		{
			label: "Fingerprint",
			value: "No multi-signal browser fingerprint is generated.",
		},
	];

	// Checked in order; the first match names the browser.
	const UA_BROWSERS: [name: string, pattern: RegExp][] = [
		["Edge", /Edg\/(\d+)/],
		["Firefox", /Firefox\/(\d+)/],
		["Chrome", /Chrome\/(\d+)/],
		["Safari", /Version\/(\d+).*Safari/],
	];

	let browser = $state(readBrowser());
	let interactionSnapshot = $state(getInteractionSnapshot());
	let refreshedAt = $state(new Date().toLocaleString());
	let now = $state(new Date());

	let requestContext = $state<RequestContextSnapshot | null>(null);
	let requestContextError = $state("");
	let requestContextLoading = $state(true);

	const geo = $derived(
		requestContext?.geolocation.available ? requestContext.geolocation : null,
	);
	const hasCoordinates = $derived(
		typeof geo?.latitude === "number" && typeof geo?.longitude === "number",
	);
	const placeName = $derived(
		[geo?.city, geo?.region].filter(Boolean).join(", ") ||
			countryName(geo?.country),
	);
	const localTime = $derived(
		now.toLocaleTimeString([], {
			hour: "numeric",
			minute: "2-digit",
			second: "2-digit",
		}),
	);

	function toDisplayValue(value: unknown): string {
		if (value === null || value === undefined || value === "") {
			return "Unavailable";
		}

		if (Array.isArray(value)) {
			return value.length > 0 ? value.join(", ") : "Unavailable";
		}

		return String(value);
	}

	function fact(label: string, value: unknown, note?: string): Fact {
		const display = toDisplayValue(value);
		return { label, value: display, note, muted: display === "Unavailable" };
	}

	function countryName(code: string | undefined): string {
		if (!code) {
			return "";
		}
		try {
			return (
				new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code
			);
		} catch {
			return code;
		}
	}

	function describeBrowser(nav: NavigatorExtras): string {
		const brands = (nav.userAgentData?.brands ?? []).filter(
			(brand) => !/not.?a.?brand/i.test(brand.brand),
		);
		const brand =
			brands.find((b) => b.brand !== "Chromium") ?? brands[0] ?? null;
		if (brand) {
			return `${brand.brand} ${brand.version}`;
		}

		for (const [name, pattern] of UA_BROWSERS) {
			const match = nav.userAgent.match(pattern);
			if (match) {
				return `${name} ${match[1]}`;
			}
		}
		return "an unrecognized browser";
	}

	function readBrowser() {
		const nav = navigator as NavigatorExtras;
		const win = window as Window & { doNotTrack?: string };

		return {
			name: describeBrowser(nav),
			os: nav.userAgentData?.platform || nav.platform,
			userAgent: nav.userAgent,
			brands:
				nav.userAgentData?.brands?.map(
					(brand) => `${brand.brand} ${brand.version}`,
				) ?? [],
			platform: nav.platform || nav.userAgentData?.platform,
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
			doNotTrack: nav.doNotTrack || win.doNotTrack || "Not set",
			cookiesEnabled: nav.cookieEnabled,
			prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
			prefersReducedMotion: window.matchMedia(
				"(prefers-reduced-motion: reduce)",
			).matches,
			referrer: document.referrer,
		};
	}

	function formatCounts(counts: Record<string, number>): string {
		const entries = Object.entries(counts);
		if (entries.length === 0) {
			return "None yet";
		}
		return entries.map(([key, count]) => `${key} ×${count}`).join(", ");
	}

	const deviceFacts = $derived<Fact[]>([
		fact("Platform", browser.platform),
		fact("Screen", browser.screen),
		fact("Window", browser.viewport),
		fact("Pixel Ratio", browser.pixelRatio),
		fact("Touch Points", browser.touchPoints),
		fact("CPU Cores", browser.cpuCores, "Reported by the browser as a hint."),
		fact(
			"Memory",
			browser.deviceMemory && `~${browser.deviceMemory} GB`,
			"Rounded hint; only some browsers expose it.",
		),
	]);

	const browserFacts = $derived<Fact[]>([
		fact("Browser", browser.name),
		fact("User Agent", browser.userAgent, "Raw browser user-agent string."),
		fact(
			"Client Hint Brands",
			browser.brands,
			"Only available in some browsers; often privacy-limited.",
		),
		fact("Cookies", browser.cookiesEnabled ? "Enabled" : "Disabled"),
		fact("Do Not Track", browser.doNotTrack),
		fact("Connection", browser.connectionType, "Estimated, not measured."),
		fact("Online", browser.online ? "Yes" : "No"),
	]);

	const preferenceFacts = $derived<Fact[]>([
		fact("Languages", browser.languages),
		fact("Timezone", browser.timezone),
		fact("Color Scheme", browser.prefersDark ? "Dark" : "Light"),
		fact(
			"Reduced Motion",
			browser.prefersReducedMotion ? "Reduce" : "No preference",
		),
	]);

	const visitFacts = $derived<Fact[]>([
		fact(
			"Tab Opened",
			new Date(interactionSnapshot.sessionStartedAt).toLocaleString(),
		),
		fact("Arrived From", browser.referrer || "Direct visit or no referrer"),
		fact("Previous Page", interactionSnapshot.previousRoute ?? "None"),
		fact("Pages Viewed", formatCounts(interactionSnapshot.routeVisitCounts)),
		fact("Projects Viewed", formatCounts(interactionSnapshot.projectViews)),
	]);

	const serverFacts = $derived.by<Fact[]>(() => {
		if (!requestContext) {
			return [];
		}
		const { request, network, headers, geolocation } = requestContext;
		const coordinates = hasCoordinates
			? `${geolocation.latitude}, ${geolocation.longitude}`
			: null;

		return [
			fact("IP Address", network.clientIp, `Source: ${network.ipSource}`),
			fact(
				"Via Proxy",
				network.hasForwardedHeaders ? "Yes (forwarded headers)" : "No",
			),
			...(geolocation.available
				? [
						fact("Country", countryName(geolocation.country)),
						fact("Region", geolocation.region),
						fact("City", geolocation.city),
						fact("Postal Code", geolocation.postal),
						fact("Timezone", geolocation.timezone),
						fact(
							"Coordinates",
							coordinates,
							`Approximate, looked up by ${geolocation.provider ?? "the edge network"}.`,
						),
					]
				: [
						fact(
							"Geolocation",
							null,
							geolocation.reason || "Lookup not available.",
						),
					]),
			fact("Request", `${request.method} ${request.path}`, requestContext.timestamp),
			fact("User-Agent Header", headers.userAgent),
			fact("Accept-Language", headers.acceptLanguage),
			fact("Referer Header", headers.referer),
			fact("DNT Header", headers.doNotTrack),
		];
	});

	async function refreshServerSnapshot(): Promise<void> {
		requestContextLoading = true;
		requestContextError = "";

		try {
			requestContext = await loadRequestContextSnapshot();
		} catch (error) {
			requestContextError = errorMessage(
				error,
				"Failed to fetch request context.",
			);
			requestContext = null;
		} finally {
			requestContextLoading = false;
		}
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

<svelte:head>
	<title>About You</title>
	<meta
		name="description"
		content="See what your browser and requests reveal during your visit. Read-only, no analytics profile created."
	/>
</svelte:head>

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
		<p class="eyebrow">> Based on your IP address, you're probably in</p>

		{#if requestContextLoading}
			<p class="place">Locating you<span class="cursor">_</span></p>
		{:else if requestContextError}
			<p class="place">Somewhere</p>
			<p class="place-sub error">{requestContextError}</p>
		{:else if geo && placeName}
			<p class="place">{placeName}</p>
			<p class="place-sub">
				{[countryName(geo.country), geo.postal].filter(Boolean).join(" · ")}
			</p>
		{:else}
			<p class="place">Somewhere unknown</p>
			<p class="place-sub">
				{requestContext?.geolocation.reason ||
					"Your IP couldn't be located."}
			</p>
		{/if}

		<ul class="dossier-lines">
			{#if requestContext}
				<li>Your IP address is <strong>{requestContext.network.clientIp}</strong>.</li>
			{/if}
			<li>
				You're using <strong>{browser.name}</strong>
				{#if browser.os}on <strong>{browser.os}</strong>{/if}.
			</li>
			<li>
				Your screen is <strong>{browser.screen}</strong>
				{#if browser.cpuCores}
					and your device has <strong>{browser.cpuCores} CPU cores</strong>
				{/if}{#if browser.deviceMemory}{" "}and
					<strong>~{browser.deviceMemory} GB</strong> of memory{/if}.
			</li>
			<li>
				It's <strong>{localTime}</strong> where you are
				({browser.timezone}){#if geo?.timezone && geo.timezone === browser.timezone},
					which matches your IP's location.{:else if geo?.timezone},
					but your IP suggests <strong>{geo.timezone}</strong>. A VPN, maybe?{:else}.{/if}
			</li>
		</ul>
	</div>

	<div class="map-column">
		{#if geo && hasCoordinates}
			<LocationMap
				latitude={geo.latitude as number}
				longitude={geo.longitude as number}
				label={placeName}
			/>
		{:else}
			<div class="map-placeholder">
				{requestContextLoading ? "Loading map..." : "No coordinates to map."}
			</div>
		{/if}
	</div>
</section>

<div class="groups">
	<section class="terminal-box group">
		<h2>> What the Server Sees</h2>
		<p class="source">From your request to this site's API</p>
		{#if requestContextLoading}
			<p>Loading request context...</p>
		{:else if requestContextError}
			<p class="error">{requestContextError}</p>
		{:else}
			<FactList facts={serverFacts} />
		{/if}
	</section>

	<section class="terminal-box group">
		<h2>> Your Device</h2>
		<p class="source">Read by JavaScript in this tab</p>
		<FactList facts={deviceFacts} />
	</section>

	<section class="terminal-box group">
		<h2>> Your Browser</h2>
		<p class="source">Read by JavaScript in this tab</p>
		<FactList facts={browserFacts} />
	</section>

	<section class="terminal-box group">
		<h2>> Your Preferences</h2>
		<p class="source">Settings your browser shares with every site</p>
		<FactList facts={preferenceFacts} />
	</section>

	<section class="terminal-box group">
		<h2>> This Visit</h2>
		<p class="source">In memory only; gone when you close the tab</p>
		<FactList facts={visitFacts} />
	</section>

	<section class="terminal-box group">
		<h2>> Not Collected</h2>
		<p class="source">Possible, but deliberately skipped</p>
		<FactList facts={NOT_COLLECTED} />
	</section>
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

	@keyframes blink {
		50% {
			opacity: 0;
		}
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
		content: "$ ";
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
		opacity: 0.7;
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
		opacity: 0.75;
	}

	.error {
		color: var(--color-error);
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

	@media (prefers-reduced-motion: reduce) {
		.cursor {
			animation: none;
		}
	}
</style>
