<script module lang="ts">
	export type FieldStatus = "available" | "unavailable" | "not-collected";
</script>

<script lang="ts">
	import type { Snippet } from "svelte";

	const STATUS_LABELS: Record<FieldStatus, string> = {
		available: "Available",
		unavailable: "Unavailable",
		"not-collected": "Not Collected",
	};

	let {
		label,
		status = "available",
		value,
		note,
		children,
	}: {
		label: string;
		status?: FieldStatus;
		value?: string;
		note?: string;
		// Replaces the plain value when given.
		children?: Snippet;
	} = $props();
</script>

<article class="field-row">
	<div class="field-meta">
		<h3>{label}</h3>
		<span class="status status-{status}">{STATUS_LABELS[status]}</span>
	</div>
	{#if children}
		{@render children()}
	{:else}
		<p class="value">{value}</p>
	{/if}
	{#if note}
		<p class="note">{note}</p>
	{/if}
</article>

<style>
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

	h3 {
		margin: 0;
		font-size: 1.05rem;
	}

	.field-row :global(.value),
	.note {
		margin: 0.3rem 0 0;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	.note {
		opacity: 0.8;
		font-size: 0.9rem;
	}

	.field-row :global(ul) {
		margin: 0.4rem 0 0;
		padding-left: 1.2rem;
	}

	.status {
		font-size: 0.8rem;
		border: 1px solid var(--color-text-primary);
		padding: 0.2rem 0.45rem;
		white-space: nowrap;
	}

	.status-unavailable {
		opacity: 0.75;
	}

	.status-not-collected {
		font-weight: 700;
	}

	@media (max-width: 768px) {
		.field-meta {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.4rem;
		}
	}
</style>
