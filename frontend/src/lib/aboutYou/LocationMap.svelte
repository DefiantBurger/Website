<script lang="ts">
	// Static slippy-map view built from OpenStreetMap tile images, centered on
	// a coordinate. No map library or iframe, so it fits the site CSP.
	const TILE_SIZE = 256;
	const TILE_URL = "https://tile.openstreetmap.org";

	let {
		latitude,
		longitude,
		zoom = 10,
		label,
	}: {
		latitude: number;
		longitude: number;
		zoom?: number;
		label: string;
	} = $props();

	let width = $state(0);
	let height = $state(0);

	type Tile = { key: string; src: string; left: number; top: number };

	// Web Mercator world-pixel position of the center point at this zoom.
	const center = $derived.by(() => {
		const worldSize = TILE_SIZE * 2 ** zoom;
		const latRad = (latitude * Math.PI) / 180;
		return {
			x: ((longitude + 180) / 360) * worldSize,
			y:
				((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
					2) *
				worldSize,
		};
	});

	const tiles = $derived.by(() => {
		if (width === 0 || height === 0) {
			return [];
		}

		const tileCount = 2 ** zoom;
		const originX = center.x - width / 2;
		const originY = center.y - height / 2;
		const result: Tile[] = [];

		for (
			let ty = Math.floor(originY / TILE_SIZE);
			ty <= Math.floor((originY + height) / TILE_SIZE);
			ty++
		) {
			if (ty < 0 || ty >= tileCount) {
				continue;
			}
			for (
				let tx = Math.floor(originX / TILE_SIZE);
				tx <= Math.floor((originX + width) / TILE_SIZE);
				tx++
			) {
				const wrappedX = ((tx % tileCount) + tileCount) % tileCount;
				result.push({
					key: `${tx}/${ty}`,
					src: `${TILE_URL}/${zoom}/${wrappedX}/${ty}.png`,
					left: tx * TILE_SIZE - originX,
					top: ty * TILE_SIZE - originY,
				});
			}
		}
		return result;
	});
</script>

<figure class="map">
	<div
		class="viewport"
		role="img"
		aria-label="Map around {label}"
		bind:clientWidth={width}
		bind:clientHeight={height}
	>
		{#each tiles as tile (tile.key)}
			<img
				class="tile"
				src={tile.src}
				alt=""
				width={TILE_SIZE}
				height={TILE_SIZE}
				style:left="{tile.left}px"
				style:top="{tile.top}px"
				draggable="false"
			/>
		{/each}
		<span class="radius" aria-hidden="true"></span>
		<span class="marker" aria-hidden="true"></span>
	</div>
	<figcaption>
		<span>{latitude.toFixed(4)}, {longitude.toFixed(4)}</span>
		<span>
			&copy; <a
				href="https://www.openstreetmap.org/copyright"
				target="_blank"
				rel="noopener noreferrer">OpenStreetMap</a
			> contributors
		</span>
	</figcaption>
</figure>

<style>
	.map {
		margin: 0;
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.viewport {
		position: relative;
		flex: 1;
		min-height: 260px;
		overflow: hidden;
		border: 1px solid var(--color-text-primary);
		background: var(--color-bg-dark);
	}

	.tile {
		position: absolute;
		max-width: none;
		user-select: none;
		/* Muted dark map to match the terminal theme. */
		filter: invert(1) hue-rotate(180deg) saturate(0.35) brightness(0.85);
	}

	:global(:root[data-theme="light"]) .tile {
		filter: saturate(0.4) contrast(0.95);
	}

	/* IP geolocation is approximate (city level), so show an area, not a pin. */
	.radius,
	.marker {
		position: absolute;
		left: 50%;
		top: 50%;
		border-radius: 50%;
		transform: translate(-50%, -50%);
	}

	.radius {
		width: 140px;
		height: 140px;
		border: 2px dashed var(--color-red);
		background: color-mix(in srgb, var(--color-red) 12%, transparent);
	}

	.marker {
		width: 14px;
		height: 14px;
		background: var(--color-red);
		box-shadow: 0 0 0 3px var(--color-bg-dark);
		animation: pulse 2s ease-out infinite;
	}

	@keyframes pulse {
		0% {
			box-shadow:
				0 0 0 3px var(--color-bg-dark),
				0 0 0 3px var(--color-red);
		}
		100% {
			box-shadow:
				0 0 0 3px var(--color-bg-dark),
				0 0 0 22px transparent;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.marker {
			animation: none;
		}
	}

	figcaption {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.25rem 1rem;
		margin-top: 0.4rem;
		font-size: 0.8rem;
		opacity: 0.8;
	}
</style>
