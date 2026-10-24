<script lang="ts">
	import { onMount } from "svelte";

	import { loadSchedulerData } from "../lib/scheduler/data";
	import {
		PRECOLLEGE_SEMESTER,
		buildRequirements,
		buildSchedule,
		createCourse,
		exportSchedule,
		getValidCredits,
		resolveCourseQuery,
		searchCatalog,
	} from "../lib/scheduler/catalog";
	import {
		computeSchedulerGraph,
		detangleCourseOrder,
	} from "../lib/scheduler/logic";
	import type {
		CourseCatalog,
		CourseInstance,
		PrereqEdge,
		ScheduleFile,
		ScheduleState,
	} from "../lib/scheduler/types";
	import { errorMessage } from "../lib/api";
	import { saveBlob } from "../lib/download";
	import PageHeader from "../lib/components/PageHeader.svelte";
	import StatusMessage from "../lib/components/StatusMessage.svelte";

	/** A prerequisite edge positioned in board coordinates. */
	type EdgeLine = Pick<
		PrereqEdge,
		"id" | "fromCourseId" | "toCourseId" | "status"
	> & {
		x1: number;
		y1: number;
		x2: number;
		y2: number;
	};

	let loading = $state(true);
	let loadError = $state<string | null>(null);

	// Schedule data. Updated immutably, so raw state is enough.
	let courseCatalog = $state.raw<CourseCatalog>({});
	let semesterOrder = $state.raw<string[]>([]);
	let coursesById = $state.raw<Record<string, CourseInstance>>({});
	let columnCourseIds = $state.raw<Record<string, string[]>>({});

	let selectedCourseId = $state<string | null>(null);
	let draggedCourseId: string | null = null;
	let dragOverSemester = $state<string | null>(null);

	let addCourseQuery = $state("");
	let addSemester = $state("");
	let notice = $state<{ kind: "error" | "success"; text: string } | null>(
		null,
	);
	let importInputElement = $state<HTMLInputElement>();

	let boardElement = $state<HTMLDivElement>();
	// Card elements by course id, for measuring edge endpoints.
	const courseElements: Record<string, HTMLElement> = {};
	let edgeLines = $state.raw<EdgeLine[]>([]);

	const semesterToIndex = $derived<Record<string, number>>({
		[PRECOLLEGE_SEMESTER]: -1,
		...Object.fromEntries(semesterOrder.map((semester, index) => [semester, index])),
	});

	const prereqsByCourseId = $derived(
		Object.fromEntries(
			Object.values(coursesById).map((course) => [
				course.id,
				buildRequirements(courseCatalog, course.name),
			]),
		),
	);

	const graph = $derived(
		computeSchedulerGraph({ coursesById, prereqsByCourseId, semesterToIndex }),
	);

	const semesterCredits = $derived(
		Object.fromEntries(
			semesterOrder.map((semester) => [
				semester,
				(columnCourseIds[semester] ?? []).reduce(
					(sum, courseId) => sum + (coursesById[courseId]?.credits ?? 0),
					0,
				),
			]),
		),
	);

	const selectedCourse = $derived(
		selectedCourseId ? (coursesById[selectedCourseId] ?? null) : null,
	);
	const selectedCourseCredits = $derived(
		selectedCourse ? getValidCredits(courseCatalog, selectedCourse.name) : [],
	);

	const catalogSuggestions = $derived(
		searchCatalog(courseCatalog, addCourseQuery),
	);

	function progressPercent(courseId: string): number | null {
		const progress = graph.requirementProgressByCourseId[courseId];
		return typeof progress === "number" ? Math.round(progress * 100) : null;
	}

	function applySchedule(schedule: ScheduleState, detangle: boolean): void {
		semesterOrder = schedule.semesterOrder;
		coursesById = schedule.coursesById;
		columnCourseIds = schedule.columnCourseIds;
		selectedCourseId = null;
		addSemester = schedule.semesterOrder[0] ?? "";
		if (detangle) {
			autoDetangle();
		}
	}

	/** Reorder courses within each semester to reduce crossing edges. */
	function autoDetangle(): void {
		columnCourseIds = detangleCourseOrder(
			semesterOrder,
			columnCourseIds,
			graph.edges,
		);
	}

	/** Attachment: keep `courseElements[courseId]` pointing at the card. */
	function trackCourseElement(courseId: string) {
		return (node: HTMLElement) => {
			courseElements[courseId] = node;
			return () => {
				if (courseElements[courseId] === node) {
					delete courseElements[courseId];
				}
			};
		};
	}

	function measureEdges(): void {
		if (!boardElement) {
			edgeLines = [];
			return;
		}

		const boardRect = boardElement.getBoundingClientRect();
		const lines: EdgeLine[] = [];

		for (const edge of graph.edges) {
			const fromRect = courseElements[edge.fromCourseId]?.getBoundingClientRect();
			const toRect = courseElements[edge.toCourseId]?.getBoundingClientRect();
			if (!fromRect || !toRect) {
				continue;
			}

			// Concurrent edges join card centers; others run right side -> left side.
			const isConcurrent = edge.requirement.canBeConcurrent;
			lines.push({
				id: edge.id,
				fromCourseId: edge.fromCourseId,
				toCourseId: edge.toCourseId,
				status: edge.status,
				x1: fromRect.left - boardRect.left + fromRect.width * (isConcurrent ? 0.5 : 0.75),
				y1: fromRect.top - boardRect.top + fromRect.height / 2,
				x2: toRect.left - boardRect.left + toRect.width * (isConcurrent ? 0.5 : 0.25),
				y2: toRect.top - boardRect.top + toRect.height / 2,
			});
		}

		// Draw invalid edges last so they sit on top.
		edgeLines = lines.sort(
			(a, b) => Number(a.status === "invalid") - Number(b.status === "invalid"),
		);
	}

	let edgeMeasureQueued = false;

	function queueEdgeMeasurement(): void {
		if (edgeMeasureQueued) {
			return;
		}

		edgeMeasureQueued = true;
		requestAnimationFrame(() => {
			edgeMeasureQueued = false;
			measureEdges();
		});
	}

	// Re-measure after anything that can move cards or change the edge set.
	$effect(() => {
		void graph;
		void columnCourseIds;
		queueEdgeMeasurement();
	});

	$effect(() => {
		if (!boardElement) {
			return;
		}
		const observer = new ResizeObserver(queueEdgeMeasurement);
		observer.observe(boardElement);
		return () => observer.disconnect();
	});

	function addCourseToSemester(): void {
		notice = null;

		const courseName = resolveCourseQuery(
			courseCatalog,
			addCourseQuery,
			catalogSuggestions,
		);
		if (!courseName) {
			notice = {
				kind: "error",
				text: "Pick a course from the search results before adding.",
			};
			return;
		}

		if (!semesterOrder.includes(addSemester)) {
			notice = { kind: "error", text: "Select a valid target semester." };
			return;
		}

		const occurrenceIndex =
			Math.max(
				0,
				...Object.values(coursesById)
					.filter((course) => course.name === courseName)
					.map((course) => course.occurrenceIndex),
			) + 1;
		const course = createCourse(
			courseCatalog,
			courseName,
			occurrenceIndex,
			addSemester,
		);

		coursesById = { ...coursesById, [course.id]: course };
		columnCourseIds = {
			...columnCourseIds,
			[addSemester]: [...(columnCourseIds[addSemester] ?? []), course.id],
		};

		selectedCourseId = course.id;
		addCourseQuery = courseName;
		notice = { kind: "success", text: `Added ${courseName} to ${addSemester}.` };
	}

	function handleExportJson(): void {
		const exportData = exportSchedule(courseCatalog, {
			semesterOrder,
			coursesById,
			columnCourseIds,
		});
		saveBlob(
			new Blob([JSON.stringify(exportData, null, 2)], {
				type: "application/json",
			}),
			"schedule-export.json",
		);
		notice = {
			kind: "success",
			text: "Exported current schedule to schedule-export.json",
		};
	}

	async function handleImportFile(
		event: Event & { currentTarget: HTMLInputElement },
	): Promise<void> {
		notice = null;

		const input = event.currentTarget;
		const file = input.files?.[0];
		if (!file) {
			return;
		}

		try {
			const parsed = JSON.parse(await file.text()) as ScheduleFile;
			if (!parsed || typeof parsed !== "object" || !parsed.semesters) {
				throw new Error(
					"Invalid schedule JSON format. Expected an object with a semesters field.",
				);
			}

			applySchedule(buildSchedule(courseCatalog, parsed), true);
			notice = { kind: "success", text: `Imported schedule from ${file.name}` };
		} catch (importError) {
			notice = {
				kind: "error",
				text: errorMessage(importError, "Failed to import schedule JSON."),
			};
		} finally {
			input.value = "";
		}
	}

	function moveCourse(
		courseId: string,
		targetSemester: string,
		targetIndex?: number,
	): void {
		const course = coursesById[courseId];
		const sourceSemester = course?.semester;
		if (!course || !columnCourseIds[sourceSemester] || !columnCourseIds[targetSemester]) {
			return;
		}

		const sourceIds = [...columnCourseIds[sourceSemester]];
		const sourceIndex = sourceIds.indexOf(courseId);
		if (sourceIndex < 0) {
			return;
		}
		sourceIds.splice(sourceIndex, 1);

		const destinationIds =
			sourceSemester === targetSemester
				? sourceIds
				: [...columnCourseIds[targetSemester]];

		let destinationIndex =
			targetIndex === undefined
				? destinationIds.length
				: Math.max(0, Math.min(targetIndex, destinationIds.length));
		if (
			sourceSemester === targetSemester &&
			targetIndex !== undefined &&
			targetIndex > sourceIndex
		) {
			destinationIndex -= 1;
		}
		destinationIds.splice(destinationIndex, 0, courseId);

		// Manual moves keep their order: no automatic detangling here.
		columnCourseIds = {
			...columnCourseIds,
			[sourceSemester]: sourceIds,
			[targetSemester]: destinationIds,
		};
		coursesById = {
			...coursesById,
			[courseId]: { ...course, semester: targetSemester },
		};
	}

	function handleDragEnd(): void {
		draggedCourseId = null;
		dragOverSemester = null;
	}

	function handleDrop(semester: string, targetCourseId?: string): void {
		if (!draggedCourseId || draggedCourseId === targetCourseId) {
			return;
		}

		const index = targetCourseId
			? columnCourseIds[semester]?.indexOf(targetCourseId)
			: undefined;
		moveCourse(
			draggedCourseId,
			semester,
			index !== undefined && index >= 0 ? index : undefined,
		);
		handleDragEnd();
	}

	function moveSelectedCourse(direction: -1 | 1): void {
		if (!selectedCourse) {
			return;
		}

		const currentIndex = semesterOrder.indexOf(selectedCourse.semester);
		const nextSemester = semesterOrder[currentIndex + direction];
		if (currentIndex >= 0 && nextSemester) {
			moveCourse(selectedCourse.id, nextSemester);
		}
	}

	function handleClearAllCourses(): void {
		if (Object.keys(coursesById).length === 0) {
			notice = { kind: "success", text: "Schedule is already empty." };
			return;
		}

		if (
			!window.confirm(
				"Clear all scheduled courses? This will remove every class from every semester.",
			)
		) {
			return;
		}

		coursesById = {};
		columnCourseIds = Object.fromEntries(
			semesterOrder.map((semester) => [semester, [] as string[]]),
		);
		selectedCourseId = null;
		notice = { kind: "success", text: "Cleared all courses from the schedule." };
	}

	function removeSelectedCourse(): void {
		const course = selectedCourse;
		if (!course) {
			return;
		}

		const { [course.id]: _removed, ...remainingCourses } = coursesById;
		coursesById = remainingCourses;
		if (columnCourseIds[course.semester]) {
			columnCourseIds = {
				...columnCourseIds,
				[course.semester]: columnCourseIds[course.semester].filter(
					(id) => id !== course.id,
				),
			};
		}

		selectedCourseId = null;
		notice = {
			kind: "success",
			text: `Removed ${course.name} from ${course.semester}.`,
		};
	}

	function updateSelectedCourseCredits(credits: number): void {
		const course = selectedCourse;
		if (course && selectedCourseCredits.includes(credits)) {
			coursesById = { ...coursesById, [course.id]: { ...course, credits } };
		}
	}

	onMount(async () => {
		try {
			const data = await loadSchedulerData();
			courseCatalog = data.catalog;
			applySchedule(data.schedule, true);
		} catch (error) {
			loadError = errorMessage(error, "Failed to load scheduler data.");
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Scheduler</title>
	<meta name="description" content="Interactive course scheduler with prerequisite validation and dependency visualization." />
</svelte:head>

<PageHeader title="Utilities / Class Scheduler">
	<p>
		Drag courses between semesters and inspect prerequisite health in
		real time. The default schedule is my own. Course data may not be
		fully accurate; please report any issues <a href="/contact">here</a>.
	</p>
</PageHeader>

{#if loading}
	<StatusMessage kind="loading" message="Bootstrapping scheduler..." />
{:else if loadError}
	<StatusMessage kind="error" message={loadError} />
{:else}
	<div class="scheduler-layout">
		<section class="terminal-box scheduler-board-wrap">
			<div class="scheduler-board" bind:this={boardElement}>
				<svg class="edge-layer" aria-hidden="true">
					{#each edgeLines as line (line.id)}
						<line
							x1={line.x1}
							y1={line.y1}
							x2={line.x2}
							y2={line.y2}
							class="edge-{line.status}"
							class:edge-highlighted={selectedCourseId === line.fromCourseId ||
								selectedCourseId === line.toCourseId}
						/>
					{/each}
				</svg>

				<div class="columns">
					{#each semesterOrder as semester (semester)}
						<div
							class="semester-column"
							class:drop-target={dragOverSemester === semester}
							role="region"
							aria-label="Semester {semester}"
							ondragover={(event) => {
								event.preventDefault();
								dragOverSemester = semester;
							}}
							ondragleave={() => {
								if (dragOverSemester === semester) {
									dragOverSemester = null;
								}
							}}
							ondrop={(event) => {
								event.preventDefault();
								handleDrop(semester);
							}}
						>
							<div class="semester-header">
								<h2>{semester}</h2>
								<span>{semesterCredits[semester] ?? 0} credits</span>
							</div>

							<div class="semester-courses">
								{#each columnCourseIds[semester] ?? [] as courseId (courseId)}
									{@const course = coursesById[courseId]}
									{@const progress = progressPercent(courseId)}
									<button
										type="button"
										{@attach trackCourseElement(courseId)}
										class="course-card"
										class:selected={selectedCourseId === courseId}
										draggable="true"
										onpointerdown={() => (selectedCourseId = courseId)}
										onfocus={() => (selectedCourseId = courseId)}
										onclick={() => (selectedCourseId = courseId)}
										ondragstart={() => {
											selectedCourseId = courseId;
											draggedCourseId = courseId;
										}}
										ondragend={handleDragEnd}
										ondragover={(event) => event.preventDefault()}
										ondrop={(event) => {
											event.preventDefault();
											event.stopPropagation();
											handleDrop(semester, courseId);
										}}
									>
										<header>
											<h3>{course.name}</h3>
											<span>{course.credits}cr</span>
										</header>

										{#if progress !== null}
											<div class="progress-wrap">
												<div class="progress-fill" style:width="{progress}%"></div>
											</div>
										{/if}
									</button>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</div>
		</section>

		<aside class="terminal-box details">
			<div class="terminal-box panel">
				<h3>Selected Course</h3>
				{#if selectedCourse}
					{@const progress = progressPercent(selectedCourse.id)}
					{@const requirementGroups = prereqsByCourseId[selectedCourse.id] ?? []}
					<p><strong>{selectedCourse.name}</strong></p>
					<p>{selectedCourse.title}</p>
					<div class="credits-row">
						<span>{selectedCourse.credits} credits</span>
						{#if selectedCourseCredits.length > 1}
							<select
								value={selectedCourse.credits}
								onchange={(event) =>
									updateSelectedCourseCredits(Number(event.currentTarget.value))}
								title="Change course credits"
							>
								{#each selectedCourseCredits as creditOption (creditOption)}
									<option value={creditOption}>{creditOption}</option>
								{/each}
							</select>
						{/if}
					</div>
					<p>Semester: {selectedCourse.semester}</p>
					{#if progress !== null}
						<p>Prereq coverage: {progress}%</p>
					{/if}

					<div class="touch-controls">
						<button type="button" onclick={() => moveSelectedCourse(-1)}>Move Earlier</button>
						<button type="button" onclick={() => moveSelectedCourse(1)}>Move Later</button>
					</div>

					<button type="button" class="danger" onclick={removeSelectedCourse}>
						Remove Course
					</button>

					<h3>Requirement Groups</h3>
					{#if requirementGroups.length === 0}
						<p>No catalog prerequisites.</p>
					{:else}
						<ul>
							{#each requirementGroups as requirement (requirement.courseChoices.join("|"))}
								<li>
									{requirement.courseChoices.join(" OR ")}
									{#if requirement.canBeConcurrent}
										<span class="req-tag">concurrent allowed</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{:else}
					<p>Select a course card to inspect details.</p>
				{/if}
			</div>

			<div class="terminal-box panel">
				<h3>Add Class</h3>
				<input
					type="text"
					placeholder="Search by course code or title"
					bind:value={addCourseQuery}
					list="course-catalog-options"
				/>
				<datalist id="course-catalog-options">
					{#each catalogSuggestions.flatMap((item) => item.labels) as label (label)}
						<option value={label} {label}></option>
					{/each}
				</datalist>

				<select bind:value={addSemester}>
					{#each semesterOrder as semester (semester)}
						<option value={semester}>{semester}</option>
					{/each}
				</select>

				<button type="button" onclick={addCourseToSemester}>Add</button>
			</div>

			<div class="scheduler-controls">
				<button type="button" onclick={autoDetangle}>Auto-detangle lines</button>
				<button type="button" class="danger" onclick={handleClearAllCourses}>
					Clear All Courses
				</button>
			</div>

			<div class="terminal-box panel">
				<h3>Import / Export</h3>
				<div class="io-actions">
					<button type="button" onclick={handleExportJson}>Export JSON</button>
					<button type="button" onclick={() => importInputElement?.click()}>
						Import JSON
					</button>
					<input
						bind:this={importInputElement}
						type="file"
						accept="application/json"
						hidden
						onchange={handleImportFile}
					/>
				</div>
			</div>

			{#if notice}
				<StatusMessage kind={notice.kind} message={notice.text} compact />
			{/if}
		</aside>
	</div>
{/if}

<style>
	.scheduler-layout {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: 1.25rem;
	}

	.scheduler-board-wrap {
		overflow: auto;
		position: relative;
		min-height: 60vh;
	}

	.scheduler-board {
		position: relative;
		min-width: 900px;
	}

	.edge-layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		/* Above card backgrounds and progress bars, below card text (see .course-card header). */
		z-index: 1;
	}

	/* Edges are dimmed unless related to the selected course; invalid ones always stand out. */
	.edge-layer line {
		stroke-width: 2;
		opacity: 0.23;
		transition: opacity 0.2s ease;
	}

	.edge-valid {
		stroke: var(--color-success);
	}

	.edge-concurrent {
		stroke: var(--color-concurrent);
		stroke-dasharray: 8 6;
	}

	.edge-layer .edge-highlighted,
	.edge-layer .edge-invalid {
		opacity: 1;
		stroke-width: 3;
		filter: drop-shadow(0 0 4px currentColor);
	}

	.edge-layer .edge-invalid {
		stroke: var(--color-error);
		filter: drop-shadow(0 0 7px var(--color-error));
	}

	.columns {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		gap: 0.85rem;
	}

	.semester-column {
		border: 1px solid var(--color-primary-opacity-30);
		border-radius: 3px;
		padding: 0.75rem;
		background: var(--color-primary-opacity-10);
		min-height: 100%;
	}

	.semester-column.drop-target {
		box-shadow: inset 0 0 0 2px var(--color-text-primary);
	}

	.semester-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		border-bottom: 1px dashed var(--color-primary-opacity-30);
		padding-bottom: 0.45rem;
	}

	.semester-header h2 {
		font-size: 1.1rem;
		border: 0;
		margin: 0;
		text-transform: uppercase;
	}

	.semester-header span {
		font-size: 0.85rem;
		opacity: 0.9;
	}

	.semester-courses {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-height: 200px;
	}

	.course-card {
		background: var(--color-primary-opacity-15);
		border: 1px solid var(--color-primary-opacity-30);
		border-radius: 3px;
		padding: 0.6rem;
		cursor: grab;
		user-select: none;
		text-align: left;
		width: 100%;
	}

	/* No press-scale: a transform would make the card its own stacking context and put the edge lines over its text. */
	.course-card:active {
		transform: none;
		cursor: grabbing;
	}

	.course-card header {
		position: relative;
		z-index: 2;
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		align-items: baseline;
	}

	.course-card h3 {
		font-size: 0.95rem;
		margin: 0;
		line-height: 1.35;
	}

	.course-card span {
		font-size: 0.8rem;
		opacity: 0.85;
	}

	.course-card.selected {
		box-shadow: 0 0 0 2px var(--color-text-primary);
		background: var(--color-primary-opacity-30);
	}

	.progress-wrap {
		height: 6px;
		width: 100%;
		background: var(--color-error-opacity-05);
		border: 1px solid var(--color-primary-opacity-30);
		margin-top: 0.55rem;
	}

	.progress-fill {
		height: 100%;
		background: var(--color-success);
	}

	.details {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}

	.scheduler-controls {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.scheduler-controls button {
		width: 100%;
		font-size: 0.86rem;
		padding: 0.55rem 0.8rem;
	}

	.panel {
		border-width: 1px;
		margin: 0;
		padding: 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.panel h3 {
		margin: 0;
		font-size: 1.1rem;
	}

	.panel p {
		font-size: 0.9rem;
	}

	.panel input,
	.panel select {
		border-color: var(--color-primary-opacity-30);
		padding: 0.45rem 0.55rem;
		font-size: 0.85rem;
	}

	.credits-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
	}

	.credits-row select {
		padding: 0.3rem 0.4rem;
		cursor: pointer;
	}

	.credits-row select:hover {
		border-color: var(--color-text-primary);
	}

	.io-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}

	.details ul {
		padding-left: 1.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.req-tag {
		display: inline-block;
		margin-left: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-concurrent);
	}

	.touch-controls {
		display: flex;
		gap: 0.6rem;
		margin: 0.35rem 0 0.8rem;
	}

	.touch-controls button {
		font-size: 0.82rem;
		padding: 0.4rem 0.7rem;
	}

	@media (max-width: 1200px) {
		.scheduler-layout {
			grid-template-columns: 1fr;
		}

		.scheduler-board {
			min-width: 760px;
		}
	}

	@media (max-width: 768px) {
		.scheduler-board-wrap {
			padding: 0.65rem;
		}

		.scheduler-board {
			min-width: 680px;
		}

		.touch-controls {
			flex-direction: column;
		}
	}
</style>
