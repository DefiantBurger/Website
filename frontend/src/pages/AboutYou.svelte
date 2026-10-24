<script lang="ts">
	import { onMount } from "svelte";

	import {
		loadRequestContextSnapshot,
		type RequestContextSnapshot,
	} from "../lib/aboutYou/api";
	import { getInteractionSnapshot } from "../lib/aboutYou/interactionStore";
	import { errorMessage } from "../lib/api";
	import PageHeader from "../lib/components/PageHeader.svelte";
	import FieldRow, { type FieldStatus } from "../lib/aboutYou/FieldRow.svelte";

	type DataField = {
		label: string;
		value: string;
		status: FieldStatus;
		note?: string;
	};

	const NOT_COLLECTED: [label: string, value: string][] = [
		["Persistent Cross-Session ID", "No user ID is created for this page."],
		[
			"Third-Party Analytics Profile",
			"No external analytics tracker is loaded here.",
		],
		["Fingerprint Score", "No multi-signal browser fingerprint is generated."],
	];

	let browserFields = $state<DataField[]>([]);
	let interactionSnapshot = $state(getInteractionSnapshot());
	let refreshedAt = $state(new Date().toLocaleString());

	let requestContext = $state<RequestContextSnapshot | null>(null);
	let requestContextError = $state("");
	let requestContextLoading = $state(true);
	let showFullIp = $state(false);

	function toDisplayValue(value: unknown): string {
		if (value === null || value === undefined || value === "") {
			return "Unavailable";
		}

		if (Array.isArray(value)) {
			return value.length > 0 ? value.join(", ") : "Unavailable";
		}

		return String(value);
	}

	function field(label: string, value: unknown, note?: string): DataField {
		const display = toDisplayValue(value);
		return {
			label,
			value: display,
			status: display === "Unavailable" ? "unavailable" : "available",
			note,
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

		const brands =
			nav.userAgentData?.brands?.map(
				(brand) => `${brand.brand} ${brand.version}`,
			) ?? [];
		const prefersDark = window.matchMedia(
			"(prefers-color-scheme: dark)",
		).matches;
		const prefersReducedMotion = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		const win = window as Window & { doNotTrack?: string };

		return [
			field(
				"User Agent",
				nav.userAgent,
				"Raw browser user-agent string.",
			),
			field(
				"Browser Brands (UA Client Hints)",
				brands,
				"Only available in some browsers; often privacy-limited.",
			),
			field("Platform", nav.platform || nav.userAgentData?.platform),
			field("Languages", nav.languages),
			field("Timezone", Intl.DateTimeFormat().resolvedOptions().timeZone),
			field(
				"Viewport Size",
				`${window.innerWidth} x ${window.innerHeight}`,
			),
			field(
				"Screen Size",
				`${window.screen.width} x ${window.screen.height}`,
			),
			field("Pixel Ratio", window.devicePixelRatio),
			field("Touch Points", nav.maxTouchPoints),
			field("CPU Cores (Hint)", nav.hardwareConcurrency),
			field("Device Memory (Hint)", nav.deviceMemory),
			field("Connection Type", nav.connection?.effectiveType),
			field("Online Status", navigator.onLine ? "Online" : "Offline"),
			field(
				"Do Not Track",
				nav.doNotTrack || win.doNotTrack || "Not set",
			),
			field("Cookies Enabled", nav.cookieEnabled ? "Yes" : "No"),
			field("Preferred Color Scheme", prefersDark ? "Dark" : "Light"),
			field(
				"Reduced Motion Preference",
				prefersReducedMotion ? "Reduce" : "No Preference",
			),
			field("Document Referrer", document.referrer || "None"),
		];
	}

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
		browserFields = collectBrowserFields();
		interactionSnapshot = getInteractionSnapshot();
		refreshedAt = new Date().toLocaleString();
	}

	onMount(() => {
		refreshLocalSnapshot();
		void refreshServerSnapshot();
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

{#snippet itemList(items: [string, unknown][])}
	<ul>
		{#each items as [label, value] (label)}
			<li>{label}: {value || value === 0 ? value : "Unavailable"}</li>
		{/each}
	</ul>
{/snippet}

{#snippet countList(counts: Record<string, number>, emptyText: string)}
	{#if Object.keys(counts).length > 0}
		{@render itemList(Object.entries(counts))}
	{:else}
		<p class="value">{emptyText}</p>
	{/if}
{/snippet}

<PageHeader
	title="About You"
	description="This page shows what your browser and requests can reveal during your visit. It is read-only and does not create a new analytics profile."
>
	<p class="refresh-time">Snapshot refreshed: {refreshedAt}</p>
	<button type="button" onclick={refreshLocalSnapshot}>
		Refresh Browser Snapshot
	</button>
</PageHeader>

<section class="terminal-box section">
	<h2>> What Your Browser Exposes Right Now</h2>
	<p class="section-intro">
		These values are available to front-end code in your current tab.
	</p>
	<div class="field-list">
		{#each browserFields as item (item.label)}
			<FieldRow {...item} />
		{/each}
	</div>
</section>

<section class="terminal-box section">
	<h2>> Interaction Summary (This Tab Only)</h2>
	<p class="section-intro">
		These counters are in-memory only and reset when this tab session ends.
	</p>

	<FieldRow label="Session Start" value={interactionSnapshot.sessionStartedAt} />
	<FieldRow
		label="Route Context"
		value="Current: {interactionSnapshot.currentRoute ??
			'None'} | Previous: {interactionSnapshot.previousRoute ?? 'None'}"
	/>
	<FieldRow label="Route Visit Counts">
		{@render countList(
			interactionSnapshot.routeVisitCounts,
			"No routes tracked yet.",
		)}
	</FieldRow>
	<FieldRow label="Project Detail Views">
		{@render countList(
			interactionSnapshot.projectViews,
			"No project detail pages viewed yet.",
		)}
	</FieldRow>
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
		{@const { request, network, headers, geolocation } = requestContext}
		<FieldRow label="Request Line" value="{request.method} {request.path}" />

		<FieldRow label="Client IP (Masked)">
			<p class="value">
				{showFullIp ? network.clientIp : network.clientIpMasked}
				(source: {network.ipSource})
			</p>
			<button type="button" onclick={() => (showFullIp = !showFullIp)}>
				{showFullIp ? "Hide Full IP" : "Show Full IP"}
			</button>
		</FieldRow>

		<FieldRow
			label="Forwarded Headers Present"
			value={network.hasForwardedHeaders ? "Yes" : "No"}
		/>

		<FieldRow
			label="Headers"
			note="Snapshot timestamp: {requestContext.timestamp}"
		>
			{@render itemList([
				["User-Agent", headers.userAgent],
				["Accept-Language", headers.acceptLanguage],
				["Referer", headers.referer],
				["Do-Not-Track", headers.doNotTrack],
			])}
		</FieldRow>

		<FieldRow label="IP-Based Geolocation">
			{#if geolocation.available}
				{@render itemList([
					["Provider", geolocation.provider],
					["Country", geolocation.country],
					["Region", geolocation.region],
					["City", geolocation.city],
					["Postal", geolocation.postal],
					["Timezone", geolocation.timezone],
					["Latitude", geolocation.latitude],
					["Longitude", geolocation.longitude],
				])}
			{:else}
				<p class="value">
					Unavailable: {geolocation.reason || "Lookup not available."}
				</p>
			{/if}
		</FieldRow>
	{/if}

	<button type="button" onclick={refreshServerSnapshot}>
		Refresh Request Snapshot
	</button>
</section>

<section class="terminal-box section">
	<h2>> Possible But Not Collected By Design</h2>
	<p class="section-intro">
		The site could technically infer these, but this feature intentionally
		does not store or profile them.
	</p>

	{#each NOT_COLLECTED as [label, value] (label)}
		<FieldRow {label} status="not-collected" {value} />
	{/each}
</section>

<style>
	.refresh-time {
		opacity: 0.8;
	}

	.section {
		margin-bottom: 1.2rem;
	}

	.section-intro {
		margin-bottom: 1rem;
		opacity: 0.9;
	}

	.field-list {
		display: grid;
		gap: 0.8rem;
	}

	.value {
		margin: 0.3rem 0 0;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	.error {
		color: var(--color-error);
	}
</style>
